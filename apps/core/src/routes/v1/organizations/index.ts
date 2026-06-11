import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganizationBillingPlan from "./[id]/billing-plan/get.js";
import mountGetOrganizationDesignMd from "./[id]/design-md/get.js";
import mountPutOrganizationDesignMd from "./[id]/design-md/put.js";
import mountGetOrganizationEnterpriseContractSummary from "./[id]/enterprise-contract-summary/get.js";
import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationInvitations from "./[id]/invitations/get.js";
import mountPatchOrganizationInvoiceEmail from "./[id]/invoice-email/patch.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";
import mountGetOrganizationStripeCustomer from "./[id]/stripe-customer/get.js";
import mountGetOrganizationSubscription from "./[id]/subscription/get.js";
import mountGetOrganizationBySlug from "./slug/[slug]/get.js";

const app = new OpenAPIHonoWithAuth();

// Mounted before the `/{id}` routes so the static `/slug` segment cannot be
// shadowed by the `{id}` path parameter.
mountGetOrganizationBySlug(app);
mountGetOrganization(app);
mountGetOrganizationMembers(app);
mountGetOrganizationInvitations(app);
mountGetOrganizationBillingPlan(app);
mountGetOrganizationEnterpriseContractSummary(app);
mountGetOrganizationStripeCustomer(app);
mountGetOrganizationSubscription(app);
mountGetOrganizationDesignMd(app);
mountPutOrganizationDesignMd(app);
mountPatchOrganizationInvoiceEmail(app);

export default app;
