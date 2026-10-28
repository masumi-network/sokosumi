import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountAnswerCmoBrandQuestion from "./brand-brain/answers/post.js";
import mountApproveCmoBrandBrain from "./brand-brain/approve/post.js";
import mountUpdateCmoBrandBrain from "./brand-brain/put.js";
import mountPauseCmoCalendarEntry from "./calendar/[id]/pause/post.js";
import mountGetCmoOverview from "./get.js";
import mountConnectCmoMeasurement from "./measurement/[provider]/connect/post.js";
import mountFinalizeCmoMeasurement from "./measurement/[provider]/finalize/post.js";
import mountChooseCmoMockPlan from "./mock-plan/post.js";
import mountCompleteCmoOnboarding from "./onboarding/complete/post.js";
import mountStartCmoOnboarding from "./onboarding/post.js";
import mountRetryCmoOnboarding from "./onboarding/retry/post.js";
import mountSetCmoAdBudget from "./strategy/ads/post.js";
import mountApplyCmoPlanAnswers from "./strategy/answers/apply/post.js";
import mountAnswerCmoPlanQuestion from "./strategy/answers/post.js";
import mountApproveCmoStrategy from "./strategy/approve/post.js";
import mountRequestCmoStrategy from "./strategy/post.js";
import mountRevertCmoUpdate from "./updates/[id]/revert/post.js";

/**
 * CMO.xyz's API. The CMO app calls it server side with the person's Sign in
 * with Sokosumi token; everything is scoped to the Cuso the caller works with,
 * so no organization header is needed.
 */
const app = new OpenAPIHonoWithAuth();

mountGetCmoOverview(app);
mountStartCmoOnboarding(app);
mountChooseCmoMockPlan(app);
mountCompleteCmoOnboarding(app);
mountRetryCmoOnboarding(app);
mountUpdateCmoBrandBrain(app);
mountApproveCmoBrandBrain(app);
mountAnswerCmoBrandQuestion(app);
mountRequestCmoStrategy(app);
mountApproveCmoStrategy(app);
mountSetCmoAdBudget(app);
mountAnswerCmoPlanQuestion(app);
mountApplyCmoPlanAnswers(app);
mountRevertCmoUpdate(app);
mountPauseCmoCalendarEntry(app);
mountConnectCmoMeasurement(app);
mountFinalizeCmoMeasurement(app);

export default app;
