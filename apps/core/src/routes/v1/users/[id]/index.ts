import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUserCredits from "./credits/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetUserCredits(app);

export default app;
