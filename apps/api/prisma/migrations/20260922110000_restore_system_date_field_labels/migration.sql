-- Keep system field labels locale-neutral in storage. The Admin UI translates
-- these known keys at render time for the active locale.
UPDATE "MemberFieldDefinition"
SET "label" = CASE "key"
  WHEN 'birth_date' THEN 'Birth date'
  WHEN 'work_anniversary_date' THEN 'Work anniversary date'
  ELSE "label"
END
WHERE "key" IN ('birth_date', 'work_anniversary_date');
