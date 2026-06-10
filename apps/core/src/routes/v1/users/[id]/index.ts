import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "../user-route-context.js";
import mountGetUserCredits from "./credits/get.js";
import mountGetUserEffectiveDesignMd from "./effective-design-md/get.js";
import mountGetUserById from "./get.js";
import mountGetUserMembers from "./members/get.js";
import mountPostUserNoticeAcknowledge from "./notices/[noticeId]/acknowledge/post.js";
import mountGetUserPendingNotices from "./notices/pending/get.js";
import mountGetUserOnboarding from "./onboarding/get.js";
import mountPostUserOnboarding from "./onboarding/post.js";
import mountGetUserOrganizationCredits from "./organizations/[organizationId]/credits/get.js";
import mountGetUserOrganizationMember from "./organizations/[organizationId]/member/get.js";
import mountGetUserOrganizations from "./organizations/get.js";
import mountGetUserPreferences from "./preferences/get.js";
import mountPatchUserPreferences from "./preferences/patch.js";
import mountGetUserStripeCustomer from "./stripe-customer/get.js";
import mountGetUserUploads from "./uploads/get.js";
import mountPostUserUploads from "./uploads/post.js";
import mountPostUserUtmAttribution from "./utm-attribution/post.js";

const app = new OpenAPIHonoWithAuth<UserRouteVariables>();

app.use("*", usersPathUserContextMiddleware);

mountGetUserCredits(app);
mountGetUserEffectiveDesignMd(app);
mountGetUserMembers(app);
mountGetUserOrganizations(app);
mountGetUserOrganizationCredits(app);
mountGetUserOrganizationMember(app);
mountGetUserPreferences(app);
mountPatchUserPreferences(app);
mountGetUserOnboarding(app);
mountPostUserOnboarding(app);
mountGetUserPendingNotices(app);
mountPostUserNoticeAcknowledge(app);
mountGetUserUploads(app);
mountPostUserUploads(app);
mountPostUserUtmAttribution(app);
mountGetUserStripeCustomer(app);
mountGetUserById(app);

export default app;
