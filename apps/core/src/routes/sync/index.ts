import { Hono } from "hono";

import mountGetAgentsSync from "./agents/get.js";
import mountGetAgentsSummarySync from "./agents-summary/get.js";
import mountGetJobSchedulesSync from "./job-schedules/get.js";

const app = new Hono();

mountGetAgentsSync(app);
mountGetAgentsSummarySync(app);
mountGetJobSchedulesSync(app);

export default app;
