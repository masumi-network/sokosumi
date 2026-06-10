import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganizationBillingPlan from "./[id]/billing-plan/get.js";
import mountGetOrganizationEnterpriseContractSummary from "./[id]/enterprise-contract-summary/get.js";
import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationInvitations from "./[id]/invitations/get.js";
import mountPatchOrganizationInvoiceEmail from "./[id]/invoice-email/patch.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";
import mountGetOrganizationStripeCustomer from "./[id]/stripe-customer/get.js";
import mountGetOrganizationSubscriptionChangeAllowed from "./[id]/subscription-change-allowed/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganization(app);
mountGetOrganizationMembers(app);
mountGetOrganizationInvitations(app);
mountGetOrganizationEnterpriseContractSummary(app);
mountGetOrganizationStripeCustomer(app);
mountGetOrganizationBillingPlan(app);
mountGetOrganizationSubscriptionChangeAllowed(app);
mountPatchOrganizationInvoiceEmail(app);

export default app;
