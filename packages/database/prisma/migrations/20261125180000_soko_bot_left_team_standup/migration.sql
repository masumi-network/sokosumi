-- Stand-up is on by default: a bot joins unless a member took it out.
ALTER TABLE "soko_bot" ADD COLUMN "leftTeamStandupAt" TIMESTAMP(3);
