import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUserCredits from "./[id]/credits/get.js";
import mountGetMeCredits from "./me/credits/get.js";
import mountGetMe from "./me/get.js";
import mountPostNoticeAcknowledge from "./me/notices/[id]/acknowledge/post.js";
import mountGetPendingNotices from "./me/notices/pending/get.js";
import mountGetMeOnboarding from "./me/onboarding/get.js";
import mountPostMeOnboarding from "./me/onboarding/post.js";
import mountGetMeOrganizationCredits from "./me/organizations/[id]/credits/get.js";
import mountGetMeOrganizations from "./me/organizations/get.js";
import mountGetMePreferences from "./me/preferences/get.js";
import mountPatchMePreferences from "./me/preferences/patch.js";
import mountGetMeUploads from "./me/uploads/get.js";
import mountPostMeUploads from "./me/uploads/post.js";
import mountGetUserRegistered from "./registered/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeOrganizations(app);
mountGetMeOrganizationCredits(app);
mountGetMeCredits(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetPendingNotices(app);
mountPostNoticeAcknowledge(app);
mountGetMeUploads(app);
mountPostMeUploads(app);
mountGetUserRegistered(app);
mountGetUserCredits(app);

export default app;
