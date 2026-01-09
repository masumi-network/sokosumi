import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeCredits from "./me/credits/get.js";
import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";
import mountGetMeOnboarding from "./me/onboarding/get.js";
import mountPostMeOnboarding from "./me/onboarding/post.js";
import mountGetMeOrganization from "./me/organizations/[id]/get.js";
import mountGetMeOrganizations from "./me/organizations/get.js";
import mountGetMePreferences from "./me/preferences/get.js";
import mountPatchMePreferences from "./me/preferences/patch.js";
import mountPostUser from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountPostUser(app);
mountGetMe(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetMeFiles(app);
mountGetMeLinks(app);
mountGetMeOrganizations(app);
mountGetMeOrganization(app);
mountGetMeCredits(app);

export default app;
