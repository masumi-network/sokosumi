import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDelete from "./delete.js";
import mountPatch from "./patch.js";

const app = new OpenAPIHonoWithAuth();

mountPatch(app);
mountDelete(app);

export default app;
