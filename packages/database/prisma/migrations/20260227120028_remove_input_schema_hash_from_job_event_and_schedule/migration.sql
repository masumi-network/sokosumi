-- Drop redundant input schema hash columns; hash is derived on demand
ALTER TABLE "jobEvent"
DROP COLUMN "inputSchemaHash";

ALTER TABLE "jobSchedule"
DROP COLUMN "inputSchemaHash";
