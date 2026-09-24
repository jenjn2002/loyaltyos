ALTER TABLE "Tier" ADD COLUMN "qualificationRules" JSONB NOT NULL DEFAULT '[]';

UPDATE "Tier"
SET "qualificationRules" = jsonb_build_array(
  jsonb_build_object('pointTypeId', "pointTypeId", 'minPoints', "minPoints")
)
WHERE "pointTypeId" IS NOT NULL;
