import { agentRepository } from "@sokosumi/database/repositories";
import { Hono } from "hono";

import { ok } from "../helpers/response";

const router = new Hono();

router.get("/", async (c) => {
  const agents =
    await agentRepository.getShownAgentsWithRelationsByStatus("ONLINE");

  return ok(c, { agents: agents.map((agent) => agent.name) });
});

export default router;
