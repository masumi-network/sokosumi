-- Task tag vocabulary v2 adds seven tags. Queue every live Task tagged under
-- v1 for one more pass, so existing work gets the new tags too. Manual and
-- rejected tags are separate columns and stay as they are; /sync/task-tags
-- drains the queue under its per-tick cost cap.
UPDATE "task"
SET "tagClassificationState" = 'unclassified',
    "tagClassificationAttempts" = 0,
    "tagClassificationLease" = NULL
WHERE "archivedAt" IS NULL
  AND "tagVocabularyVersion" < 2;
