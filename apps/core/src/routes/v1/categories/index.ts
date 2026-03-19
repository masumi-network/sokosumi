import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCategories from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetCategories(app);

export default app;
