import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { cmoClientCheck } from "./cmo-client-check.js";

import mountListCmoCusos from "./cusos/get.js";
import mountStartCmoOnboarding from "./onboarding/post.js";
import mountListCmoPlans from "./plans/get.js";
import mountConnectCmoAdsForProject from "./projects/[projectId]/ads/[provider]/connect/post.js";
import mountChooseCmoAdAccountForProject from "./projects/[projectId]/ads/accounts/post.js";
import mountListCmoAdCampaignsForProject from "./projects/[projectId]/ads/campaigns/get.js";
import mountSetCmoAdCampaignStatusForProject from "./projects/[projectId]/ads/campaigns/status/post.js";
import mountListCmoAdChoicesForProject from "./projects/[projectId]/ads/connections/[adConnectionId]/choices/get.js";
import mountFinalizeCmoAdsForProject from "./projects/[projectId]/ads/finalize/post.js";
import mountLaunchCmoSearchAdForProject from "./projects/[projectId]/ads/launch/post.js";
import mountAnswerCmoBrandBrainQuestionForProject from "./projects/[projectId]/brand-brain/answers/post.js";
import mountConfirmCmoBrandBrainForProject from "./projects/[projectId]/brand-brain/confirm/post.js";
import mountUpdateCmoBrandBrainForProject from "./projects/[projectId]/brand-brain/put.js";
import mountPauseCmoCalendarEntryForProject from "./projects/[projectId]/calendar/[id]/pause/post.js";
import mountGetCmoCalendarEntryTextForProject from "./projects/[projectId]/calendar/[id]/text/get.js";
import mountStartCmoPlanCheckoutForProject from "./projects/[projectId]/checkout/post.js";
import mountGetCmoOverviewForProject from "./projects/[projectId]/get.js";
import mountAnswerCmoMarketingStrategyQuestionForProject from "./projects/[projectId]/marketing-strategies/[strategyId]/answers/post.js";
import mountApproveCmoMarketingStrategyForProject from "./projects/[projectId]/marketing-strategies/[strategyId]/approve/post.js";
import mountConnectCmoMeasurementForProject from "./projects/[projectId]/measurement/[provider]/connect/post.js";
import mountFinalizeCmoMeasurementForProject from "./projects/[projectId]/measurement/[provider]/finalize/post.js";
import mountRetryCmoOnboardingForProject from "./projects/[projectId]/onboarding/retry/post.js";
import mountFinalizeCmoSocialConnectionForProject from "./projects/[projectId]/social-connections/finalize/post.js";
import mountInitiateCmoSocialConnectionForProject from "./projects/[projectId]/social-connections/initiate/post.js";
import mountStartCmoOverForProject from "./projects/[projectId]/start-over/post.js";
import mountSetCmoAdBudgetForProject from "./projects/[projectId]/strategy/ads/post.js";
import mountApplyCmoPlanAnswersForProject from "./projects/[projectId]/strategy/answers/apply/post.js";
import mountRequestCmoStrategyForProject from "./projects/[projectId]/strategy/post.js";
import mountStartCmoTopUpForProject from "./projects/[projectId]/top-up/post.js";
import mountRevertCmoUpdateForProject from "./projects/[projectId]/updates/[id]/revert/post.js";

/**
 * CMO.xyz's API. The CMO app calls it server side with the person's Sign in
 * with Sokosumi token. Every Cuso action names him by his Project
 * (`/projects/{projectId}/…`); only hiring and the list of the caller's
 * Cusos go by the caller alone. No organization header is needed.
 */
const app = new OpenAPIHonoWithAuth();

app.use("*", cmoClientCheck);

mountListCmoCusos(app);
mountStartCmoOnboarding(app);
mountListCmoPlans(app);

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
mountStartCmoPlanCheckoutForProject(app);
mountConnectCmoMeasurementForProject(app);
mountFinalizeCmoMeasurementForProject(app);
mountRetryCmoOnboardingForProject(app);
mountStartCmoOverForProject(app);
mountSetCmoAdBudgetForProject(app);
mountApplyCmoPlanAnswersForProject(app);
mountRequestCmoStrategyForProject(app);
mountStartCmoTopUpForProject(app);
mountRevertCmoUpdateForProject(app);

// Writes CMO made on the shared Project routes (ADR 0066); those stay too.
mountUpdateCmoBrandBrainForProject(app);
mountConfirmCmoBrandBrainForProject(app);
mountAnswerCmoBrandBrainQuestionForProject(app);
mountApproveCmoMarketingStrategyForProject(app);
mountAnswerCmoMarketingStrategyQuestionForProject(app);
mountInitiateCmoSocialConnectionForProject(app);
mountFinalizeCmoSocialConnectionForProject(app);

export default app;
