import { agentRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import { ok } from "@/helpers/response";

import { agentsSchema } from "./schemas";

export async function getAgentsHandler(c: Context) {
  const agents = await agentRepository.getAgentsWithRelations();
  const response = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
  }));

  return ok(c, agentsSchema.parse(response));
}
