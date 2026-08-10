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
import mountPostCoworkerUnarchive from "./[id]/unarchive/post.js";
import mountPatchCoworkerWhitelistById from "./[id]/whitelist/patch.js";
import mountGetCoworkerWorkspaceAccess from "./[id]/workspace-access/get.js";
import mountPostCoworkerWorkspaceAccess from "./[id]/workspace-access/post.js";
import mountPostRevokeCoworkerWorkspaceAccess from "./[id]/workspace-access/revoke/post.js";
import mountGetCoworkers from "./get.js";
import mountGetCoworkerMeEvents from "./me/events/get.js";
import mountGetCoworkerMe from "./me/get.js";
import mountPostCoworkerMeUsage from "./me/usage/post.js";
import mountPostCoworker from "./post.js";

// Product catalog scope=available needs workspace resolution (whitelist ∪
// GRANTED for active workspace). Without this, requireWorkspaceContext always
// throws "Workspace is missing" and chat/task pickers 403.
const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

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
mountGetCoworkerWorkspaceAccess(app);
mountPostCoworkerWorkspaceAccess(app);
mountPostRevokeCoworkerWorkspaceAccess(app);
mountPostCoworkerUnarchive(app);
mountDeleteCoworkerById(app);

export default app;
