import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";
import mountPatchMe from "./me/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountPatchMe(app);
mountGetMeFiles(app);
mountGetMeLinks(app);

export default app;
