-- Replace the retired Spanish locale with Vietnamese in existing data and defaults.
UPDATE "Program"
SET "defaultLocale" = 'vi-VN'
WHERE "defaultLocale" = 'es-MX';

UPDATE "Program"
SET "supportedLocales" = array_replace("supportedLocales", 'es-MX', 'vi-VN')
WHERE "supportedLocales" @> ARRAY['es-MX']::TEXT[];

UPDATE "Member"
SET "locale" = 'vi-VN'
WHERE "locale" = 'es-MX';

UPDATE "AdminUser"
SET "locale" = 'vi-VN'
WHERE "locale" = 'es-MX';

UPDATE "NotificationTemplate"
SET "locale" = 'vi-VN'
WHERE "locale" = 'es-MX';

UPDATE "TermsTemplate"
SET "locale" = 'vi-VN'
WHERE "locale" = 'es-MX';

ALTER TABLE "Program"
  ALTER COLUMN "defaultLocale" SET DEFAULT 'vi-VN',
  ALTER COLUMN "supportedLocales" SET DEFAULT ARRAY['vi-VN', 'en-US']::TEXT[];

ALTER TABLE "AdminUser"
  ALTER COLUMN "locale" SET DEFAULT 'vi-VN';

ALTER TABLE "NotificationTemplate"
  ALTER COLUMN "locale" SET DEFAULT 'vi-VN';

ALTER TABLE "TermsTemplate"
  ALTER COLUMN "locale" SET DEFAULT 'vi-VN';
