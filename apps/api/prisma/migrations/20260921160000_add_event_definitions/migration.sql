CREATE TABLE "EventDefinition" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventDefinition_programId_key_key" ON "EventDefinition"("programId", "key");
CREATE INDEX "EventDefinition_programId_isActive_key_idx" ON "EventDefinition"("programId", "isActive", "key");

ALTER TABLE "EventDefinition" ADD CONSTRAINT "EventDefinition_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EventDefinition" ("id", "programId", "key", "name", "description", "createdAt", "updatedAt")
SELECT
  'event_' || lower(replace(p.id, '-', '')) || '_' || v.key,
  p.id,
  v.key,
  v.name,
  v.description,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Program" p
CROSS JOIN (VALUES
  ('registration', 'Registration', 'Member account created'),
  ('purchase', 'Purchase', 'A purchase or transaction event'),
  ('birthday', 'Birthday', 'Member birthday event'),
  ('work_anniversary', 'Work anniversary', 'Member work anniversary event'),
  ('company_date', 'Company date', 'A fixed company date'),
  ('campaign_launch', 'Campaign launch', 'A campaign or special-date launch'),
  ('referral', 'Referral', 'A referral event'),
  ('tier_upgrade', 'Tier upgrade', 'Member tier upgrade event')
) AS v(key, name, description)
ON CONFLICT ("programId", "key") DO NOTHING;
