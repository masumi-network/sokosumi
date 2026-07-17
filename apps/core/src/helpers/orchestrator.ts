import { orchestratorSchema } from "@/schemas/orchestrator.schema";

interface OrchestratorRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  slug: string;
  name: string;
  caption: string | null;
  description: string | null;
}

export function mapOrchestrator(orchestrator: OrchestratorRow) {
  return orchestratorSchema.parse(orchestrator);
}
