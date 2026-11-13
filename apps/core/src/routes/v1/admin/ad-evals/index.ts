import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountExport from "./export/get.js";
import mountGet from "./get.js";

const app = new OpenAPIHonoWithAuth();
mountGet(app);
mountExport(app);

export default app;
