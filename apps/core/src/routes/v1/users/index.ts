import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";
import mountPatchMeOnboardingCompleted from "./me/onboarding-completed/patch.js";
import mountPatchMe from "./me/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountPatchMe(app);
mountPatchMeOnboardingCompleted(app);
mountGetMeFiles(app);
mountGetMeLinks(app);

export default app;
