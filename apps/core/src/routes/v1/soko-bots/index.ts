import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { mountSokoBotApiKeyRoutes } from "./api-keys.js";
import { mountSokoBotAvatarRoutes } from "./avatars.js";
import { mountSokoBotIntegrationByIdRoutes } from "./by-id/integrations.js";
import { mountSokoBotScheduleByIdRoutes } from "./by-id/schedules.js";
import { mountSokoBotEventRoutes } from "./events.js";
import { sokoBotRouteGate } from "./helpers.js";
import { mountSokoBotIntegrationAuthRoutes } from "./integration-auth.js";
import mountGetIntegrationsCatalog from "./integrations/catalog/get.js";
import mountGetMySokoBotActivity, {
  mountById as mountGetSokoBotActivity,
} from "./me/activity/get.js";
import mountClaimMySokoBotAvatar from "./me/avatar/post.js";
import mountUpdateMySokoBotBoardFollowing, {
  mountById as mountUpdateSokoBotBoardFollowing,
} from "./me/board-following/put.js";
import mountResolveMySokoBotDecision, {
  mountById as mountResolveSokoBotDecision,
} from "./me/decisions/[decisionId]/post.js";
import mountArchiveMySokoBot, {
  mountById as mountArchiveSokoBot,
} from "./me/delete.js";
import mountGetMySokoBot, { mountById as mountGetSokoBot } from "./me/get.js";
import mountConnectMySokoBotIntegration from "./me/integrations/[provider]/connect/post.js";
import mountDisconnectMySokoBotIntegration from "./me/integrations/[provider]/delete.js";
import mountFinalizeMySokoBotIntegration from "./me/integrations/[provider]/finalize/post.js";
import mountGetMySokoBotIntegrations from "./me/integrations/get.js";
import mountIntroduceMySokoBot from "./me/introduce/post.js";
import mountRunMySokoBotLabIngest from "./me/lab/ingest/post.js";
import mountJudgeMySokoBotLabTurn from "./me/lab/judge/post.js";
import mountListMySokoBotLabRuns from "./me/lab/runs/get.js";
import mountSimulateMySokoBotTaskEvent from "./me/lab/task-event/post.js";
import mountResetMySokoBotMemory, {
  mountById as mountResetSokoBotMemory,
} from "./me/memory/reset/post.js";
import mountDeleteMySokoBotPermanently, {
  mountById as mountDeleteSokoBotPermanently,
} from "./me/permanent/delete.js";
import mountCreateMySokoBot from "./me/post.js";
import mountUpdateMySokoBotProactive, {
  mountById as mountUpdateSokoBotProactive,
} from "./me/proactive/put.js";
import mountDeleteMySokoBotSchedule from "./me/schedules/[scheduleId]/delete.js";
import mountUpdateMySokoBotSchedule from "./me/schedules/[scheduleId]/patch.js";
import mountCreateMySokoBotSchedule from "./me/schedules/post.js";
import mountRemoveMySokoBotSkill from "./me/skills/[skillId]/delete.js";
import mountListMySokoBotSkills from "./me/skills/get.js";
import mountInstallMySokoBotSkill from "./me/skills/post.js";
import mountGetMySokoBotStats from "./me/stats/get.js";
import mountSendMySokoBotTurnFeedback from "./me/turns/[id]/feedback/post.js";
import mountCancelMySokoBotTurn, {
  mountById as mountCancelSokoBotTurn,
} from "./me/turns/[turnId]/cancel/post.js";
import mountGetMySokoBotTurn, {
  mountById as mountGetSokoBotTurn,
} from "./me/turns/[turnId]/get.js";
import mountGetMySokoBotTurnResults, {
  mountById as mountGetSokoBotTurnResults,
} from "./me/turns/[turnId]/results/get.js";
import mountListMySokoBotTurns, {
  mountById as mountListSokoBotTurns,
} from "./me/turns/get.js";
import mountStartMySokoBotTurn, {
  mountById as mountStartSokoBotTurn,
} from "./me/turns/post.js";
import mountGetMySokoBotUsage, {
  mountById as mountGetSokoBotUsage,
} from "./me/usage/get.js";
import mountUpdateMySokoBotVersion, {
  mountById as mountUpdateSokoBotVersion,
} from "./me/version/put.js";
import mountCreateSokoBot, {
  mountById as mountReactivateSokoBot,
} from "./post.js";
import mountBrowseSokoBotSkills from "./skills/browse/get.js";
import mountSearchSokoBotSkills from "./skills/search/get.js";
import mountGetSokoBotTeam from "./team/get.js";
import mountListSokoBotVersions from "./versions/get.js";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

app.use("*", sokoBotRouteGate);

mountSokoBotApiKeyRoutes(app);
mountSokoBotEventRoutes(app);
mountSokoBotIntegrationAuthRoutes(app);
mountGetMySokoBot(app);
mountGetMySokoBotActivity(app);
mountGetMySokoBotUsage(app);
mountCreateMySokoBot(app);
mountArchiveMySokoBot(app);
mountDeleteMySokoBotPermanently(app);
mountStartMySokoBotTurn(app);
mountListMySokoBotTurns(app);
mountGetMySokoBotTurn(app);
mountGetMySokoBotTurnResults(app);
mountCancelMySokoBotTurn(app);
mountResetMySokoBotMemory(app);
mountCreateMySokoBotSchedule(app);
mountUpdateMySokoBotSchedule(app);
mountDeleteMySokoBotSchedule(app);
mountResolveMySokoBotDecision(app);
mountSokoBotAvatarRoutes(app);
mountGetMySokoBotIntegrations(app);
mountGetIntegrationsCatalog(app);
mountConnectMySokoBotIntegration(app);
mountFinalizeMySokoBotIntegration(app);
mountDisconnectMySokoBotIntegration(app);
mountIntroduceMySokoBot(app);
mountClaimMySokoBotAvatar(app);
mountListSokoBotVersions(app);
mountUpdateMySokoBotProactive(app);
mountSendMySokoBotTurnFeedback(app);
mountUpdateMySokoBotBoardFollowing(app);
mountUpdateMySokoBotVersion(app);
mountRunMySokoBotLabIngest(app);
mountSimulateMySokoBotTaskEvent(app);
mountGetSokoBotTeam(app);
mountGetMySokoBotStats(app);
mountListMySokoBotSkills(app);
mountInstallMySokoBotSkill(app);
mountRemoveMySokoBotSkill(app);
mountSearchSokoBotSkills(app);
mountBrowseSokoBotSkills(app);
mountListMySokoBotLabRuns(app);
mountJudgeMySokoBotLabTurn(app);
mountCreateSokoBot(app);

// `/{sokoBotId}` routes last: a static route above (`/me`, `/team`, ...) wins
// the path.
mountGetSokoBotActivity(app);
mountArchiveSokoBot(app);
mountGetSokoBot(app);
mountResetSokoBotMemory(app);
mountDeleteSokoBotPermanently(app);
mountUpdateSokoBotProactive(app);
mountUpdateSokoBotBoardFollowing(app);
mountResolveSokoBotDecision(app);
mountCancelSokoBotTurn(app);
mountGetSokoBotTurn(app);
mountGetSokoBotTurnResults(app);
mountListSokoBotTurns(app);
mountStartSokoBotTurn(app);
mountGetSokoBotUsage(app);
mountUpdateSokoBotVersion(app);
mountReactivateSokoBot(app);
mountSokoBotIntegrationByIdRoutes(app);
mountSokoBotScheduleByIdRoutes(app);

export default app;
