import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { type UserRouteVariables } from "@/routes/v1/users/user-route-context";

import mountPostApproveVendorGrant from "./[grantId]/approve/post.js";
import mountPostDenyVendorGrant from "./[grantId]/deny/post.js";
import mountPostRevokeVendorGrant from "./[grantId]/revoke/post.js";
import mountGetVendorAccess from "./get.js";

const app = new OpenAPIHonoWithAuth<UserRouteVariables>();

mountGetVendorAccess(app);
mountPostApproveVendorGrant(app);
mountPostDenyVendorGrant(app);
mountPostRevokeVendorGrant(app);

export default app;
