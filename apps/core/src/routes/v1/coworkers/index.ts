import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteCoworkerApiKey from "./[id]/api-keys/delete.js";
import mountGetCoworkerApiKeys from "./[id]/api-keys/get.js";
import mountPatchCoworkerApiKey from "./[id]/api-keys/patch.js";
import mountPostCoworkerApiKey from "./[id]/api-keys/post.js";
import mountDeleteCoworkerById from "./[id]/delete.js";
import mountGetCoworkerById from "./[id]/get.js";
import mountDeleteCoworkerImage from "./[id]/image/delete.js";
import mountPostCoworkerImage from "./[id]/image/post.js";
import mountPatchCoworkerById from "./[id]/patch.js";
import mountPatchCoworkerWhitelistById from "./[id]/whitelist/patch.js";
import mountGetCoworkers from "./get.js";
import mountGetCoworkerMeEvents from "./me/events/get.js";
import mountGetCoworkerMe from "./me/get.js";
import mountPostCoworkerMeUsage from "./me/usage/post.js";
import mountPostCoworker from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkers(app);
mountPostCoworker(app);
mountGetCoworkerMe(app);
mountGetCoworkerMeEvents(app);
mountPostCoworkerMeUsage(app);
mountGetCoworkerApiKeys(app);
mountPostCoworkerApiKey(app);
mountPatchCoworkerApiKey(app);
mountDeleteCoworkerApiKey(app);
mountGetCoworkerById(app);
mountPostCoworkerImage(app);
mountDeleteCoworkerImage(app);
mountPatchCoworkerById(app);
mountPatchCoworkerWhitelistById(app);
mountDeleteCoworkerById(app);

export default app;
