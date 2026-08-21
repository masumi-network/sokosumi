import { Hono } from "hono";

import mountGetAgentsSync from "./agents/get.js";
import mountGetAgentsSummarySync from "./agents-summary/get.js";
import mountGetChatRoomGuestInvitationsExpireSync from "./chat-room-guest-invitations-expire/get.js";
import mountGetEnterpriseContractsRenewalSync from "./enterprise-contracts-renewal/get.js";
import mountGetFreeSubscriptionsRenewalSync from "./free-subscriptions-renewal/get.js";
import mountGetHermesPollInboxesSync from "./hermes-poll-inboxes/get.js";
import mountGetJobsSync from "./jobs/get.js";
import mountGetSourceImportSync from "./source-import/get.js";
import mountGetStripeCustomersSync from "./stripe-customers/get.js";
import mountGetTaskPaymentClaimsSync from "./task-payment-claims/get.js";
import mountGetTaskSchedulesSync from "./task-schedules/get.js";
import mountGetTaskX402PaymentHeadersPurgeSync from "./task-x402-payment-headers-purge/get.js";

const app = new Hono();

mountGetAgentsSync(app);
mountGetAgentsSummarySync(app);
mountGetChatRoomGuestInvitationsExpireSync(app);
mountGetEnterpriseContractsRenewalSync(app);
mountGetFreeSubscriptionsRenewalSync(app);
mountGetHermesPollInboxesSync(app);
mountGetJobsSync(app);
mountGetSourceImportSync(app);
mountGetStripeCustomersSync(app);
mountGetTaskPaymentClaimsSync(app);
mountGetTaskSchedulesSync(app);
mountGetTaskX402PaymentHeadersPurgeSync(app);

export default app;
