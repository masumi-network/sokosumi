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
  'UNKNOWN'
);

-- Add origin column to task event
ALTER TABLE "taskEvent" ADD COLUMN "origin" "TaskEventOrigin";
