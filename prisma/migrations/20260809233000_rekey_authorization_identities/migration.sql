-- Membership authorization keys actors by better-auth user IDs. Preserve the existing
-- reviewer and CFP administrator rows while replacing their legacy email identifiers.
UPDATE "evaluation_reviewers" AS reviewer
SET "identityId" = member_user."id"
FROM "user" AS member_user
WHERE lower(member_user."email") = lower(btrim(reviewer."email"))
  AND reviewer."identityId" <> member_user."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "evaluation_reviewers" AS existing
    WHERE existing."eventId" = reviewer."eventId"
      AND existing."identityId" = member_user."id"
  );

UPDATE "cfp_administrators" AS administrator
SET "externalId" = member_user."id"
FROM "user" AS member_user
WHERE lower(member_user."email") = lower(btrim(administrator."externalId"))
  AND administrator."externalId" <> member_user."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "cfp_administrators" AS existing
    WHERE existing."eventId" = administrator."eventId"
      AND existing."externalId" = member_user."id"
  );
