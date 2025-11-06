import { agentRepository } from "@sokosumi/database/repositories";

import { ok } from "@/helpers/response";
import type { AuthedContext } from "@/types/authed-context";

import { agentsSchema } from "./schemas";

export async function getAgentsHandler(c: AuthedContext) {
  const agents = await agentRepository.getAgentsWithRelations();
  const response = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
  }));

  return ok(c, agentsSchema.parse(response));
}
