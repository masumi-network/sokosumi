import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganizationBillingPlan from "./[id]/billing-plan/get.js";
import mountOrganizationDesignMd from "./[id]/design-md/index.js";
import mountGetOrganizationEnterpriseContractSummary from "./[id]/enterprise-contract-summary/get.js";
import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationInvitations from "./[id]/invitations/get.js";
import mountPatchOrganizationInvoiceEmail from "./[id]/invoice-email/patch.js";
import mountOrganizationMemberSeat from "./[id]/members/[memberId]/seat/index.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";
import mountGetOrganizationStripeCustomer from "./[id]/stripe-customer/get.js";
import mountGetOrganizationBySlug from "./by-slug/[slug]/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganizationBySlug(app);
mountGetOrganization(app);
mountGetOrganizationBillingPlan(app);
mountGetOrganizationMembers(app);
mountOrganizationMemberSeat(app);
mountGetOrganizationInvitations(app);
mountPatchOrganizationInvoiceEmail(app);
mountOrganizationDesignMd(app);
mountGetOrganizationEnterpriseContractSummary(app);
mountGetOrganizationStripeCustomer(app);

export default app;
