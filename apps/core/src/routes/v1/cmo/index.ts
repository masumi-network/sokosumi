import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountUpdateCmoBrandBrain from "./brand-brain/put.js";
import mountPauseCmoCalendarEntry from "./calendar/[id]/pause/post.js";
import mountGetCmoOverview from "./get.js";
import mountChooseCmoMockPlan from "./mock-plan/post.js";
import mountFinishCmoAccountsStep from "./onboarding/accounts-done/post.js";
import mountCompleteCmoOnboarding from "./onboarding/complete/post.js";
import mountStartCmoOnboarding from "./onboarding/post.js";
import mountRetryCmoOnboarding from "./onboarding/retry/post.js";
import mountApproveCmoStrategy from "./strategy/approve/post.js";
import mountRequestCmoStrategy from "./strategy/post.js";
import mountRevertCmoUpdate from "./updates/[id]/revert/post.js";

/**
 * CMO.xyz's API. The CMO app calls it server side with the person's Sign in
 * with Sokosumi token; everything is scoped to the caller's own CMO hire,
 * so no organization header is needed.
 */
const app = new OpenAPIHonoWithAuth();

mountGetCmoOverview(app);
mountStartCmoOnboarding(app);
mountChooseCmoMockPlan(app);
mountFinishCmoAccountsStep(app);
mountCompleteCmoOnboarding(app);
mountRetryCmoOnboarding(app);
mountUpdateCmoBrandBrain(app);
mountRequestCmoStrategy(app);
mountApproveCmoStrategy(app);
mountRevertCmoUpdate(app);
mountPauseCmoCalendarEntry(app);

export default app;
