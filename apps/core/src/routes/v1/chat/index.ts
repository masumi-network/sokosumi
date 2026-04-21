import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetChat from "./get.js";
import mountPostChat from "./post.js";
import mountStreamGetChat from "./stream-get.js";

const app = new OpenAPIHonoWithAuth();

mountGetChat(app);
mountStreamGetChat(app);
mountPostChat(app);

export default app;
