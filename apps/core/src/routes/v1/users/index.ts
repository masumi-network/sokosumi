import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";
import mountPostMeOnboardingCompleted from "./me/onboarding-completed/post.js";
import mountPatchMe from "./me/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountPatchMe(app);
mountPostMeOnboardingCompleted(app);
mountGetMeFiles(app);
mountGetMeLinks(app);

export default app;
