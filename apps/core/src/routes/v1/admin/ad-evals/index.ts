import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountAccess from "./access/get.js";
import mountExport from "./export/get.js";
import mountGet from "./get.js";

const app = new OpenAPIHonoWithAuth();
mountAccess(app);
mountGet(app);
mountExport(app);

export default app;
