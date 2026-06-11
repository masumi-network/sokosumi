import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostDemoJob from "./[id]/demo-jobs/post.js";
import mountGetAgentById from "./[id]/get.js";
import mountGetAgentInputSchema from "./[id]/input-schema/get.js";
import mountGetJobsByAgentId from "./[id]/jobs/get.js";
import mountPostAgentJob from "./[id]/jobs/post.js";
import mountGetAgentRatingEligibility from "./[id]/ratings/eligibility/get.js";
import mountPostAgentRating from "./[id]/ratings/post.js";
import mountGetAgentReviews from "./[id]/reviews/get.js";
import mountGetMyAgentReview from "./[id]/reviews/me/get.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

mountGetAgents(app);
mountGetAgentById(app);
mountGetAgentReviews(app);
mountGetMyAgentReview(app);
mountGetAgentRatingEligibility(app);
mountPostAgentRating(app);
mountGetAgentInputSchema(app);
mountGetJobsByAgentId(app);
mountPostAgentJob(app);
mountPostDemoJob(app);

export default app;
