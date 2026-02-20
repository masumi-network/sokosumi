import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeCredits from "./credits/get.js";
import mountGetMeFiles from "./files/get.js";
import mountPostMeFiles from "./files/post.js";
import mountGetMe from "./get.js";
import mountPostNoticeAcknowledge from "./notices/[id]/acknowledge/post.js";
import mountGetPendingNotices from "./notices/pending/get.js";
import mountGetMeOnboarding from "./onboarding/get.js";
import mountPostMeOnboarding from "./onboarding/post.js";
import mountGetMeOrganizationCredits from "./organizations/[id]/credits/get.js";
import mountGetMeOrganization from "./organizations/[id]/get.js";
import mountGetMeOrganizations from "./organizations/get.js";
import mountGetMePreferences from "./preferences/get.js";
import mountPatchMePreferences from "./preferences/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeOrganizations(app);
mountGetMeOrganization(app);
mountGetMeOrganizationCredits(app);
mountGetMeCredits(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetPendingNotices(app);
mountPostNoticeAcknowledge(app);
mountGetMeFiles(app);
mountPostMeFiles(app);

export default app;
