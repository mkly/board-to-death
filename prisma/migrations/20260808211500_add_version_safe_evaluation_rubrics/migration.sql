ALTER TABLE "evaluation_criteria"
ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION prevent_historical_evaluation_criterion_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  criterion_id UUID := COALESCE(OLD."id", NEW."id");
  criterion_round_id UUID := COALESCE(OLD."roundId", NEW."roundId");
  version_status "EvaluationPlanVersionStatus";
BEGIN
  SELECT version."status"
  INTO version_status
  FROM "evaluation_rounds" AS round
  JOIN "evaluation_plan_versions" AS version ON version."id" = round."planVersionId"
  WHERE round."id" = criterion_round_id;

  IF version_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'evaluation criteria on active or retired plan versions are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "evaluation_results"
    WHERE "criterionId" = criterion_id
  ) THEN
    RAISE EXCEPTION 'evaluation criteria referenced by results are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "evaluation_criteria_preserve_history"
BEFORE INSERT OR UPDATE OR DELETE ON "evaluation_criteria"
FOR EACH ROW
EXECUTE FUNCTION prevent_historical_evaluation_criterion_changes();

CREATE OR REPLACE FUNCTION validate_active_evaluation_rubric()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' AND OLD."status" IS DISTINCT FROM 'ACTIVE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "evaluation_rounds"
      WHERE "planVersionId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'active evaluation plan versions require at least one round'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "evaluation_rounds" AS round
      WHERE round."planVersionId" = NEW."id"
        AND NOT EXISTS (
          SELECT 1
          FROM "evaluation_criteria" AS criterion
          WHERE criterion."roundId" = round."id"
        )
    ) THEN
      RAISE EXCEPTION 'every round in an active evaluation plan version requires rubric criteria'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "evaluation_rounds" AS round
      JOIN "evaluation_criteria" AS criterion ON criterion."roundId" = round."id"
      WHERE round."planVersionId" = NEW."id"
      GROUP BY round."id"
      HAVING SUM(criterion."weight") <= 0
    ) THEN
      RAISE EXCEPTION 'active evaluation rubric weights must have a nonzero total'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "evaluation_plan_versions_validate_rubric"
BEFORE UPDATE OF "status" ON "evaluation_plan_versions"
FOR EACH ROW
EXECUTE FUNCTION validate_active_evaluation_rubric();
