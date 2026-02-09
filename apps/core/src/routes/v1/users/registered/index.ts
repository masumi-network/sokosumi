import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUserRegistered from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetUserRegistered(app);

export default app;
