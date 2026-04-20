import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUserCredits from "./[id]/credits/get.js";
import mountGetUserById from "./[id]/get.js";
import mountPostUserNoticeAcknowledge from "./[id]/notices/[noticeId]/acknowledge/post.js";
import mountGetUserPendingNotices from "./[id]/notices/pending/get.js";
import mountGetUserOnboarding from "./[id]/onboarding/get.js";
import mountPostUserOnboarding from "./[id]/onboarding/post.js";
import mountGetUserOrganizationCredits from "./[id]/organizations/[organizationId]/credits/get.js";
import mountGetUserOrganizations from "./[id]/organizations/get.js";
import mountGetUserPreferences from "./[id]/preferences/get.js";
import mountPatchUserPreferences from "./[id]/preferences/patch.js";
import mountGetUserUploads from "./[id]/uploads/get.js";
import mountPostUserUploads from "./[id]/uploads/post.js";
import mountGetUserRegistered from "./registered/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetUserRegistered(app);

mountGetUserCredits(app);
mountGetUserOrganizations(app);
mountGetUserOrganizationCredits(app);
mountGetUserPreferences(app);
mountPatchUserPreferences(app);
mountGetUserOnboarding(app);
mountPostUserOnboarding(app);
mountGetUserPendingNotices(app);
mountPostUserNoticeAcknowledge(app);
mountGetUserUploads(app);
mountPostUserUploads(app);
mountGetUserById(app);

export default app;
