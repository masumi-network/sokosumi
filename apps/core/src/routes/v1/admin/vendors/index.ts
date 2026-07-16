import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteAdminVendor from "./[id]/delete.js";
import mountPatchAdminVendor from "./[id]/patch.js";
import mountListAdminVendors from "./get.js";
import mountCreateAdminVendor from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminVendors(app);
mountCreateAdminVendor(app);
mountPatchAdminVendor(app);
mountDeleteAdminVendor(app);

export default app;
