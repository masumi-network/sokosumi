import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUser from "./[id]/get";
import mountGetMe from "./me/get";

console.log("[module-load]", import.meta.url);

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetUser(app);

export default app;
