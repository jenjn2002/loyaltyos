-- Give funding is fixed by the point type. Existing mixed-source types now use
-- their renewable allowance, preserving the allowance policy they configured.
UPDATE "PointTypeDefinition"
SET
  "giveSource" = 'ALLOWANCE',
  "allowanceAmount" = COALESCE("allowanceAmount", 0),
  "description" = CASE
    WHEN "description" = 'Recognition credit. Owned balance never expires; Give can use owned balance or a renewable allowance.'
      THEN 'Recognition credit. Owned balance never expires; Give uses a separate renewable allowance.'
    ELSE "description"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "giveSource" = 'BOTH';

ALTER TABLE "PointTypeDefinition"
  DROP CONSTRAINT "PointTypeDefinition_giveSource_check";

ALTER TABLE "PointTypeDefinition"
  ADD CONSTRAINT "PointTypeDefinition_giveSource_check"
    CHECK ("giveSource" IN ('BALANCE', 'ALLOWANCE'));
