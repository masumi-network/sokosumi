import { Agent } from "@prisma/client";

export function getName(agent: Agent) {
  return agent.overrideName ?? agent.name;
}
