import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountCopy from "./copy.js";
import mountGet from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGet(app);
mountCopy(app);

export default app;
