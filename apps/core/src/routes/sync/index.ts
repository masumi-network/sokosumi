import { Hono } from "hono";

import mountGetAgentsSync from "./agents/get.js";
import mountGetAgentsSummarySync from "./agents-summary/get.js";
import mountGetJobsSync from "./jobs/get.js";

const app = new Hono();

mountGetAgentsSync(app);
mountGetAgentsSummarySync(app);
mountGetJobsSync(app);

export default app;
