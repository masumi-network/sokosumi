import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGetAdminUserPreprodAccess from "./[id]/preprod-access/get.js";
import mountSetAdminUserPreprodAccess from "./[id]/preprod-access/put.js";
import mountListAdminUsers from "./get.js";

const app = createNestedOpenAPIHono();

mountListAdminUsers(app);
mountGetAdminUserPreprodAccess(app);
mountSetAdminUserPreprodAccess(app);

export default app;
