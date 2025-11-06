import { agentRepository } from "@sokosumi/database/repositories";
import type { Context } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { ok } from "@/helpers/response";
import type { AuthContext } from "@/middleware/auth";

import { agentsSchema } from "./schemas";

type AuthedContext = Context<{
  Variables: { auth: AuthContext } & RequestIdVariables;
}>;

export async function getAgentsHandler(c: AuthedContext) {
  const agents = await agentRepository.getAgentsWithRelations();
  const response = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
  }));

  return ok(c, agentsSchema.parse(response));
}
