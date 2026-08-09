ALTER TABLE "cfp_policy_transitions"
DROP CONSTRAINT "cfp_policy_transitions_allowed";

ALTER TABLE "cfp_policy_transitions"
ADD CONSTRAINT "cfp_policy_transitions_allowed" CHECK (
    ("fromStatus" IS NULL AND "toStatus" = 'DRAFT')
    OR ("fromStatus" = 'DRAFT' AND "toStatus" = 'PUBLISHED')
    OR ("fromStatus" = 'PUBLISHED' AND "toStatus" = 'CLOSED')
    OR ("fromStatus" = 'CLOSED' AND "toStatus" IN ('PUBLISHED', 'ARCHIVED'))
);
