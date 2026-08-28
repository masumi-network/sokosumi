import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGet from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGet(app);

export default app;
