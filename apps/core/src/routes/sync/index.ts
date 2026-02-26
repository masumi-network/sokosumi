import { Hono } from "hono";

import mountGetAgentsSync from "./agents/get.js";
import mountGetAgentsSummarySync from "./agents-summary/get.js";
import mountGetJobSchedulesSync from "./job-schedules/get.js";
import mountGetSourceImportSync from "./source-import/get.js";
import mountGetStripeCustomersSync from "./stripe-customers/get.js";

const app = new Hono();

mountGetAgentsSync(app);
mountGetAgentsSummarySync(app);
mountGetJobSchedulesSync(app);
mountGetSourceImportSync(app);
mountGetStripeCustomersSync(app);

export default app;
