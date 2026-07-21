import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteOrchestratorApiKey from "./[id]/api-keys/delete.js";
import mountGetOrchestratorApiKeys from "./[id]/api-keys/get.js";
import mountPatchOrchestratorApiKey from "./[id]/api-keys/patch.js";
import mountPostOrchestratorApiKey from "./[id]/api-keys/post.js";
import mountDeleteOrchestratorById from "./[id]/delete.js";
import mountGetOrchestratorById from "./[id]/get.js";
import mountDeleteOrchestratorImage from "./[id]/image/delete.js";
import mountPostOrchestratorImage from "./[id]/image/post.js";
import mountPatchOrchestratorById from "./[id]/patch.js";
import mountGetOrchestrators from "./get.js";
import mountDeleteOrchestratorMeApiKey from "./me/api-keys/delete.js";
import mountGetOrchestratorMeApiKeys from "./me/api-keys/get.js";
import mountPatchOrchestratorMeApiKey from "./me/api-keys/patch.js";
import mountPostOrchestratorMeApiKey from "./me/api-keys/post.js";
import mountGetOrchestratorMe from "./me/get.js";
import mountPostOrchestratorMeUsage from "./me/usage/post.js";
import mountPostOrchestrator from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrchestrators(app);
mountPostOrchestrator(app);
mountGetOrchestratorMe(app);
mountGetOrchestratorMeApiKeys(app);
mountPostOrchestratorMeApiKey(app);
mountPatchOrchestratorMeApiKey(app);
mountDeleteOrchestratorMeApiKey(app);
mountPostOrchestratorMeUsage(app);
mountGetOrchestratorApiKeys(app);
mountPostOrchestratorApiKey(app);
mountPatchOrchestratorApiKey(app);
mountDeleteOrchestratorApiKey(app);
mountPostOrchestratorImage(app);
mountDeleteOrchestratorImage(app);
mountGetOrchestratorById(app);
mountPatchOrchestratorById(app);
mountDeleteOrchestratorById(app);

export default app;
