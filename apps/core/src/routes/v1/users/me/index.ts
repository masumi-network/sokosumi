import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeCredits from "./credits/get.js";
import mountGetMeFiles from "./files/get.js";
import mountGetMe from "./get.js";
import mountGetMeLinks from "./links/get.js";
import mountGetMeOnboarding from "./onboarding/get.js";
import mountPostMeOnboarding from "./onboarding/post.js";
import mountGetMeOrganization from "./organizations/[id]/get.js";
import mountGetMeOrganizations from "./organizations/get.js";
import mountGetMePreferences from "./preferences/get.js";
import mountPatchMePreferences from "./preferences/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeOrganizations(app);
mountGetMeOrganization(app);
mountGetMeCredits(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetMeFiles(app);
mountGetMeLinks(app);

export default app;
