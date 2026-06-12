import { Hono } from "hono";

import mountPostStripeWebhook from "./stripe/post.js";

const app = new Hono();

mountPostStripeWebhook(app);

export default app;
