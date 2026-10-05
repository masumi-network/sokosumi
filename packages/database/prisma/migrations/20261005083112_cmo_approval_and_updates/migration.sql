-- CMO: the owner approves the strategy once; Cuso's reports and replaced
-- strategies (for revert) live with the workspace.
ALTER TABLE "cmo_workspace" ADD COLUMN "strategyApprovedAt" TIMESTAMP(3);
ALTER TABLE "cmo_workspace" ADD COLUMN "strategyHistory" JSONB;
ALTER TABLE "cmo_workspace" ADD COLUMN "updates" JSONB;
