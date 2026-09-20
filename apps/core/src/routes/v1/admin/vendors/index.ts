import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDeleteAdminVendor from "./[id]/delete.js";
import mountPatchAdminVendor from "./[id]/patch.js";
import mountListAdminVendors from "./get.js";
import mountCreateAdminVendor from "./post.js";

const app = createNestedOpenAPIHono();

mountListAdminVendors(app);
mountCreateAdminVendor(app);
mountPatchAdminVendor(app);
mountDeleteAdminVendor(app);

export default app;
