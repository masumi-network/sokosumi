import { OpenAPIHono } from "@hono/zod-openapi";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgentInputSchema from "./[id]/input-schema/get.js";
import mountGetJobsByAgentId from "./[id]/jobs/get.js";
import mountPostAgentJob from "./[id]/jobs/post.js";
import mountGetAgentRatingEligibility from "./[id]/ratings/eligibility/get.js";
import mountPostAgentRating from "./[id]/ratings/post.js";
import mountGetAgentReviews from "./[id]/reviews/get.js";
import mountGetMyAgentReview from "./[id]/reviews/me/get.js";
import mountGetAgents from "./get.js";

// GET / is public catalog — cookie-free `'use cache'` consumers need anonymous
// access. It must NOT sit on OpenAPIHonoWithAuth.
const publicRoutes = new OpenAPIHono();
mountGetAgents(publicRoutes);

// Agent by-id and nested routes remain authenticated.
const authedRoutes = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

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
