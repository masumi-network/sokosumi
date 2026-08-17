import { OpenAPIHonoWithAuth } from "@/lib/hono";

import idRouter from "./[id]/index.js";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountPost(app);
mountGet(app);

app.route("", idRouter);

export default app;
