import { Hono } from "hono";

import mountGetAgentsSync from "./agents/get.js";
import mountGetAgentsSummarySync from "./agents-summary/get.js";
import mountGetCalendarInvalidationsSync from "./calendar-invalidations/get.js";
import mountGetChatRoomGuestInvitationsExpireSync from "./chat-room-guest-invitations-expire/get.js";
import mountGetEnterpriseContractsRenewalSync from "./enterprise-contracts-renewal/get.js";
import mountGetFreeSubscriptionsRenewalSync from "./free-subscriptions-renewal/get.js";
import mountGetJobsSync from "./jobs/get.js";
import mountGetNotificationFollowUpsSync from "./notification-follow-ups/get.js";
import mountGetNotificationPublishesSync from "./notification-publishes/get.js";
import mountGetProjectClosesSync from "./project-closes/get.js";
import mountGetSocialPostsPublishSync from "./social-posts-publish/get.js";
import mountGetSokoBotAvatarsSync from "./soko-bot-avatars/get.js";
import mountGetSokoBotEventsSync from "./soko-bot-events/get.js";
import mountGetSokoBotIngestSync from "./soko-bot-ingest/get.js";
import mountGetSokoBotSchedulesSync from "./soko-bot-schedules/get.js";
import mountGetSokoBotTurnsSync from "./soko-bot-turns/get.js";
import mountGetSourceImportSync from "./source-import/get.js";
import mountGetStripeCustomersSync from "./stripe-customers/get.js";
import mountGetTaskPaymentClaimsSync from "./task-payment-claims/get.js";
import mountGetTaskSchedulesSync from "./task-schedules/get.js";
import mountGetTaskX402PaymentHeadersPurgeSync from "./task-x402-payment-headers-purge/get.js";

const app = new Hono();

mountGetAgentsSync(app);
mountGetAgentsSummarySync(app);
mountGetCalendarInvalidationsSync(app);
mountGetChatRoomGuestInvitationsExpireSync(app);
mountGetEnterpriseContractsRenewalSync(app);
mountGetFreeSubscriptionsRenewalSync(app);
mountGetJobsSync(app);
mountGetNotificationFollowUpsSync(app);
mountGetNotificationPublishesSync(app);
mountGetProjectClosesSync(app);
mountGetSocialPostsPublishSync(app);
mountGetSourceImportSync(app);
mountGetSokoBotEventsSync(app);
mountGetSokoBotAvatarsSync(app);
mountGetSokoBotIngestSync(app);
mountGetSokoBotSchedulesSync(app);
mountGetSokoBotTurnsSync(app);
mountGetStripeCustomersSync(app);
mountGetTaskPaymentClaimsSync(app);
mountGetTaskSchedulesSync(app);
mountGetTaskX402PaymentHeadersPurgeSync(app);

export default app;
