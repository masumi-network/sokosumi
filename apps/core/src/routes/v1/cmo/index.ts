import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountCmoAds from "./ads/routes.js";
import mountPauseCmoCalendarEntry from "./calendar/[id]/pause/post.js";
import mountGetCmoCalendarEntryText from "./calendar/[id]/text/get.js";
import mountGetCmoOverview from "./get.js";
import mountConnectCmoMeasurement from "./measurement/[provider]/connect/post.js";
import mountFinalizeCmoMeasurement from "./measurement/[provider]/finalize/post.js";
import mountStartCmoOnboarding from "./onboarding/post.js";
import mountRetryCmoOnboarding from "./onboarding/retry/post.js";
import mountConnectCmoAdsForProject from "./projects/[projectId]/ads/[provider]/connect/post.js";
import mountChooseCmoAdAccountForProject from "./projects/[projectId]/ads/accounts/post.js";
import mountListCmoAdCampaignsForProject from "./projects/[projectId]/ads/campaigns/get.js";
import mountSetCmoAdCampaignStatusForProject from "./projects/[projectId]/ads/campaigns/status/post.js";
import mountListCmoAdChoicesForProject from "./projects/[projectId]/ads/connections/[adConnectionId]/choices/get.js";
import mountFinalizeCmoAdsForProject from "./projects/[projectId]/ads/finalize/post.js";
import mountLaunchCmoSearchAdForProject from "./projects/[projectId]/ads/launch/post.js";
import mountPauseCmoCalendarEntryForProject from "./projects/[projectId]/calendar/[id]/pause/post.js";
import mountGetCmoCalendarEntryTextForProject from "./projects/[projectId]/calendar/[id]/text/get.js";
import mountGetCmoOverviewForProject from "./projects/[projectId]/get.js";
import mountConnectCmoMeasurementForProject from "./projects/[projectId]/measurement/[provider]/connect/post.js";
import mountFinalizeCmoMeasurementForProject from "./projects/[projectId]/measurement/[provider]/finalize/post.js";
import mountRetryCmoOnboardingForProject from "./projects/[projectId]/onboarding/retry/post.js";
import mountStartCmoOverForProject from "./projects/[projectId]/start-over/post.js";
import mountSetCmoAdBudgetForProject from "./projects/[projectId]/strategy/ads/post.js";
import mountApplyCmoPlanAnswersForProject from "./projects/[projectId]/strategy/answers/apply/post.js";
import mountRequestCmoStrategyForProject from "./projects/[projectId]/strategy/post.js";
import mountRevertCmoUpdateForProject from "./projects/[projectId]/updates/[id]/revert/post.js";
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

mountConnectCmoAdsForProject(app);
mountChooseCmoAdAccountForProject(app);
mountListCmoAdCampaignsForProject(app);
mountSetCmoAdCampaignStatusForProject(app);
mountListCmoAdChoicesForProject(app);
mountFinalizeCmoAdsForProject(app);
mountLaunchCmoSearchAdForProject(app);
mountPauseCmoCalendarEntryForProject(app);
mountGetCmoCalendarEntryTextForProject(app);
mountGetCmoOverviewForProject(app);
mountConnectCmoMeasurementForProject(app);
mountFinalizeCmoMeasurementForProject(app);
mountRetryCmoOnboardingForProject(app);
mountStartCmoOverForProject(app);
mountSetCmoAdBudgetForProject(app);
mountApplyCmoPlanAnswersForProject(app);
mountRequestCmoStrategyForProject(app);
mountRevertCmoUpdateForProject(app);

export default app;
