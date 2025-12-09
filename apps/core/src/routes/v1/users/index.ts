import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";
import mountGetMeOnboarding from "./me/onboarding/get.js";
import mountPostMeOnboarding from "./me/onboarding/post.js";
import mountGetMePreferences from "./me/preferences/get.js";
import mountPatchMePreferences from "./me/preferences/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetMeFiles(app);
mountGetMeLinks(app);

export default app;
