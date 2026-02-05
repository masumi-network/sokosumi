-- Add task event origin enum
CREATE TYPE "TaskEventOrigin" AS ENUM (
  'SLACK',
  'TEAMS',
  'EMAIL',
  'LINEAR',
  'GITHUB',
  'WHATSAPP',
  'TELEGRAM',
  'SIGNAL',
  'CHAT',
  'SOKOSUMI',
  'UNKNOWN'
);

-- Add origin column to task event (required, default SOKOSUMI per schema)
ALTER TABLE "taskEvent" ADD COLUMN "origin" "TaskEventOrigin" NOT NULL DEFAULT 'SOKOSUMI';
