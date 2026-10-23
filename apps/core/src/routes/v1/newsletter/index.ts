import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAvailability from "./availability/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetAvailability(app);

export default app;
