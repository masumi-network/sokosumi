import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook, OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgentInputSchema from "./[id]/input-schema/get.js";
import mountGetJobsByAgentId from "./[id]/jobs/get.js";
import mountPostAgentJob from "./[id]/jobs/post.js";
import mountGetAgentRatingEligibility from "./[id]/ratings/eligibility/get.js";
import mountPostAgentRating from "./[id]/ratings/post.js";
import mountGetAgentReviews from "./[id]/reviews/get.js";
import mountGetMyAgentReview from "./[id]/reviews/me/get.js";
import mountGetAgents from "./get.js";
import mountGetX402Agents from "./x402/get.js";

// GET / is public catalog — cookie-free `'use cache'` consumers need anonymous
// access. It must NOT sit on OpenAPIHonoWithAuth. Still needs defaultValidationHook
// so query validation returns 422 (same as OpenAPIHonoWithAuth), not raw 400.
const publicRoutes = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});
mountGetAgents(publicRoutes);

// Agent by-id and nested routes remain authenticated.
const authedRoutes = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

// Mounted before the by-id route so the static "/x402" segment can never be
// captured by the "/{id}" parameter.
mountGetX402Agents(authedRoutes);
mountGetAgentById(authedRoutes);
mountGetAgentReviews(authedRoutes);
mountGetMyAgentReview(authedRoutes);
mountGetAgentRatingEligibility(authedRoutes);
mountPostAgentRating(authedRoutes);
mountGetAgentInputSchema(authedRoutes);
mountGetJobsByAgentId(authedRoutes);
mountPostAgentJob(authedRoutes);

const app = new OpenAPIHono();
app.route("/", publicRoutes);
app.route("/", authedRoutes);

export default app;
