import { z } from "@hono/zod-openapi";

import { agentSchema } from "@/routes/v1/agents/schemas";
import { userSchema } from "@/routes/v1/users/schemas";

const agentsSchema = z.array(agentSchema);
const usersSchema = z.array(userSchema);

export const dummyAgents = agentsSchema.parse([
  {
    id: "agent_dummy_research",
    name: "Research Assistant",
  },
  {
    id: "agent_dummy_operations",
    name: "Operations Assistant",
  },
  {
    id: "agent_dummy_support",
    name: "Support Assistant",
  },
]);

export function findDummyAgentById(id: string) {
  return dummyAgents.find((agent) => agent.id === id) ?? null;
}

export const dummyUsers = usersSchema.parse([
  {
    id: "user_dummy_primary",
    name: "Ada Lovelace",
    email: "ada.lovelace@sokosumi.test",
  },
  {
    id: "user_dummy_secondary",
    name: "Grace Hopper",
    email: "grace.hopper@sokosumi.test",
  },
]);

export function findDummyUserById(id: string) {
  return dummyUsers.find((candidate) => candidate.id === id) ?? null;
}

export const primaryDummyUser = dummyUsers[0];

