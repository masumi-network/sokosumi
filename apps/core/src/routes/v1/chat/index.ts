import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetChat from "./get.js";
import mountPostChat from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetChat(app);
mountPostChat(app);

export default app;
