import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeCredits from "./credits/get.js";
import mountGetMe from "./get.js";
import mountGetMeOnboarding from "./onboarding/get.js";
import mountPostMeOnboarding from "./onboarding/post.js";
import mountGetMeOrganization from "./organizations/[id]/get.js";
import mountGetMeOrganizations from "./organizations/get.js";
import mountGetMePreferences from "./preferences/get.js";
import mountPatchMePreferences from "./preferences/patch.js";
import mountGetMeUploads from "./uploads/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeOrganizations(app);
mountGetMeOrganization(app);
mountGetMeCredits(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetMeUploads(app);

export default app;
