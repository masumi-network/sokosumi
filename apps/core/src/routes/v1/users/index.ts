import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostMeCompleteOnboarding from "./me/complete-onboarding/post.js";
import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";
import mountPatchMePreferences from "./me/preferences/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountPatchMePreferences(app);
mountPostMeCompleteOnboarding(app);
mountGetMeFiles(app);
mountGetMeLinks(app);

export default app;
