import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountListVendors from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListVendors(app);

export default app;
