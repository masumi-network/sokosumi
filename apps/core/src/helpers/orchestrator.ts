import { orchestratorSchema } from "@/schemas/orchestrator.schema";

interface OrchestratorRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  userId: string;
  name: string | null;
  avatarSeed: string | null;
  personalityTone: number | null;
  personalityDetail: number | null;
  personalityStyle: number | null;
  lastPolledAt: Date | null;
  lastInboxMessageAt: Date | null;
  lastSeenInboxAt: Date | null;
  consecutivePollErrors: number;
}

export function mapOrchestrator(orchestrator: OrchestratorRow) {
  return orchestratorSchema.parse(orchestrator);
}
