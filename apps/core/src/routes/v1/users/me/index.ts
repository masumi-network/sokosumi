import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeCredits from "./credits/get.js";
import mountGetMe from "./get.js";
import mountPostNoticeAcknowledge from "./notices/[id]/acknowledge/post.js";
import mountGetPendingNotices from "./notices/pending/get.js";
import mountGetMeOnboarding from "./onboarding/get.js";
import mountPostMeOnboarding from "./onboarding/post.js";
import mountGetMeOrganizationCredits from "./organizations/[id]/credits/get.js";
import mountGetMeOrganizations from "./organizations/get.js";
import mountGetMePreferences from "./preferences/get.js";
import mountPatchMePreferences from "./preferences/patch.js";
import mountGetMeUploads from "./uploads/get.js";
import mountPostMeUploads from "./uploads/post.js";

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

export default app;
