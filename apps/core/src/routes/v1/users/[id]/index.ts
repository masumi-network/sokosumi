import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUserCredits from "./credits/get.js";
import mountGetUserById from "./get.js";
import mountPostUserNoticeAcknowledge from "./notices/[noticeId]/acknowledge/post.js";
import mountGetUserPendingNotices from "./notices/pending/get.js";
import mountGetUserOnboarding from "./onboarding/get.js";
import mountPostUserOnboarding from "./onboarding/post.js";
import mountGetUserOrganizationCredits from "./organizations/[organizationId]/credits/get.js";
import mountGetUserOrganizations from "./organizations/get.js";
import mountGetUserPreferences from "./preferences/get.js";
import mountPatchUserPreferences from "./preferences/patch.js";
import mountGetUserUploads from "./uploads/get.js";
import mountPostUserUploads from "./uploads/post.js";
import { usersPathUserExistsMiddleware } from "../path-user-middleware.js";

const app = new OpenAPIHonoWithAuth();

app.use("*", usersPathUserExistsMiddleware);

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
