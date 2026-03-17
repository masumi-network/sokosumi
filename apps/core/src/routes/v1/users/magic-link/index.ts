import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostUsersMagicLink from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountPostUsersMagicLink(app);

export default app;
