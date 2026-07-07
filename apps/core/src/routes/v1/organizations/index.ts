import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetOrganizationBillingDetails from "./[id]/billing-details/get.js";
import mountPatchOrganizationBillingDetails from "./[id]/billing-details/patch.js";
import mountGetOrganizationBillingPlan from "./[id]/billing-plan/get.js";
import mountGetOrganizationDesignMd from "./[id]/design-md/get.js";
import mountPutOrganizationDesignMd from "./[id]/design-md/put.js";
import mountGetOrganizationEnterpriseContractSummary from "./[id]/enterprise-contract-summary/get.js";
import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationInvitations from "./[id]/invitations/get.js";
import mountPatchOrganizationInvoiceEmail from "./[id]/invoice-email/patch.js";
import mountDeleteOrganizationMemberSeat from "./[id]/members/[memberId]/seat/delete.js";
import mountPutOrganizationMemberSeat from "./[id]/members/[memberId]/seat/put.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";
import mountGetOrganizationSeatSummary from "./[id]/seat-summary/get.js";
import mountGetOrganizationStripeCustomer from "./[id]/stripe-customer/get.js";
import mountPostOrganizationStripeCustomer from "./[id]/stripe-customer/post.js";
import mountGetOrganizationSubscription from "./[id]/subscription/get.js";
import mountPutOrganizationSubscriptionSeats from "./[id]/subscription/seats/put.js";
import mountGetOrganizationBySlug from "./slug/[slug]/get.js";

const app = new OpenAPIHonoWithAuth();

// Mounted before the `/{id}` routes so the static `/slug` segment cannot be
// shadowed by the `{id}` path parameter.
mountGetOrganizationBySlug(app);
mountGetOrganization(app);
mountGetOrganizationMembers(app);
mountPutOrganizationMemberSeat(app);
mountDeleteOrganizationMemberSeat(app);
mountGetOrganizationInvitations(app);
mountGetOrganizationSeatSummary(app);
mountGetOrganizationBillingPlan(app);
mountGetOrganizationEnterpriseContractSummary(app);
mountGetOrganizationStripeCustomer(app);
mountPostOrganizationStripeCustomer(app);
mountGetOrganizationBillingDetails(app);
mountPatchOrganizationBillingDetails(app);
mountGetOrganizationSubscription(app);
mountPutOrganizationSubscriptionSeats(app);
mountGetOrganizationDesignMd(app);
mountPutOrganizationDesignMd(app);
mountPatchOrganizationInvoiceEmail(app);

export default app;
