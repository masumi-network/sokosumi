import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountCmoAds from "./ads/routes.js";
import mountPauseCmoCalendarEntry from "./calendar/[id]/pause/post.js";
import mountGetCmoCalendarEntryText from "./calendar/[id]/text/get.js";
import mountGetCmoOverview from "./get.js";
import mountConnectCmoMeasurement from "./measurement/[provider]/connect/post.js";
import mountFinalizeCmoMeasurement from "./measurement/[provider]/finalize/post.js";
import mountStartCmoOnboarding from "./onboarding/post.js";
import mountRetryCmoOnboarding from "./onboarding/retry/post.js";
import mountStartCmoOver from "./start-over/post.js";
import mountSetCmoAdBudget from "./strategy/ads/post.js";
import mountApplyCmoPlanAnswers from "./strategy/answers/apply/post.js";
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
mountRetryCmoOnboarding(app);
mountStartCmoOver(app);
mountRequestCmoStrategy(app);
mountSetCmoAdBudget(app);
mountApplyCmoPlanAnswers(app);
mountRevertCmoUpdate(app);
mountPauseCmoCalendarEntry(app);
mountGetCmoCalendarEntryText(app);
mountConnectCmoMeasurement(app);
mountFinalizeCmoMeasurement(app);
mountCmoAds(app);

export default app;
