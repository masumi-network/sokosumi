-- The shared Jev admission ceiling counts over "admittedAt" alone, across
-- every workspace, so the existing ("workspaceId", "admittedAt") index could
-- not serve it. The sequential scan that resulted took a relation-wide
-- predicate lock, which is why one workspace's admissions conflicted with
-- another's.
CREATE INDEX "file_authorization_admission_admittedAt_idx"
  ON "file_authorization_admission"("admittedAt");
