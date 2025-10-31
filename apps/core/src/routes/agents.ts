import { agentRepository } from "@sokosumi/database/repositories";
import { Hono } from "hono";

const router = new Hono();

router.get("/agents", async (c) => {
  try {
    const agents =
      await agentRepository.getShownAgentsWithRelationsByStatus("ONLINE");
    return c.json({ agents: agents.map((agent) => agent.name) });
  } catch (error) {
    console.error("Failed to fetch agents:", error);
    return c.json({ error: "Failed to fetch agents" }, 500);
  }
});

export default router;
