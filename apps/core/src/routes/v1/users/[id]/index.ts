import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerUserRouteAllowlistMiddleware } from "../user-coworker-route-allowlist.js";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "../user-route-context.js";
import mountGetUserBillingDetails from "./billing-details/get.js";
import mountGetUserCredits from "./credits/get.js";
import mountGetUserDesignMd from "./design-md/get.js";
import mountPutUserDesignMd from "./design-md/put.js";
import mountGetUserFiles from "./files/get.js";
import mountPostUserFiles from "./files/post.js";
import mountGetUserById from "./get.js";
import mountGetUserMembers from "./members/get.js";
import mountPostUserNoticeAcknowledge from "./notices/[noticeId]/acknowledge/post.js";
import mountGetUserPendingNotices from "./notices/pending/get.js";
import mountDeleteUserOauthConsent from "./oauth-consents/[consentId]/delete.js";
import mountGetUserOnboarding from "./onboarding/get.js";
import mountPostUserOnboarding from "./onboarding/post.js";
import mountGetUserOrganizationCredits from "./organizations/[organizationId]/credits/get.js";
import mountGetUserOrganizationMember from "./organizations/[organizationId]/member/get.js";
import mountGetUserOrganizations from "./organizations/get.js";
import mountGetUserPreferences from "./preferences/get.js";
import mountPatchUserPreferences from "./preferences/patch.js";
import mountPutUserPreferredOrganization from "./preferred-organization/put.js";
import mountGetUserStripeCustomer from "./stripe-customer/get.js";
import mountPostUserStripeCustomer from "./stripe-customer/post.js";
import mountGetUserSubscription from "./subscription/get.js";
import mountPostUserUtmAttribution from "./utm-attribution/post.js";
import mountApproveUserVendorGrant from "./vendor-grants/[grantId]/approve/post.js";
import mountDenyUserVendorGrant from "./vendor-grants/[grantId]/deny/post.js";
import mountRevokeUserVendorGrant from "./vendor-grants/[grantId]/revoke/post.js";
import mountGetUserVendorGrants from "./vendor-grants/get.js";
import mountPostUserVendorGrants from "./vendor-grants/post.js";

const app = new OpenAPIHonoWithAuth<UserRouteVariables>();

app.use("*", usersPathUserContextMiddleware);
app.use("*", coworkerUserRouteAllowlistMiddleware);

mountGetUserCredits(app);
mountGetUserDesignMd(app);
mountPutUserDesignMd(app);
mountGetUserMembers(app);
mountGetUserOrganizations(app);
mountGetUserOrganizationCredits(app);
mountGetUserOrganizationMember(app);
mountGetUserPreferences(app);
mountPatchUserPreferences(app);
mountPutUserPreferredOrganization(app);
mountDeleteUserOauthConsent(app);
mountGetUserOnboarding(app);
mountPostUserOnboarding(app);
mountGetUserPendingNotices(app);
mountPostUserNoticeAcknowledge(app);
mountGetUserFiles(app);
mountPostUserFiles(app);
mountPostUserUtmAttribution(app);
mountGetUserVendorGrants(app);
mountPostUserVendorGrants(app);
mountApproveUserVendorGrant(app);
mountDenyUserVendorGrant(app);
mountRevokeUserVendorGrant(app);
mountGetUserStripeCustomer(app);
mountPostUserStripeCustomer(app);
mountGetUserBillingDetails(app);
mountGetUserSubscription(app);
mountGetUserById(app);

export default app;
