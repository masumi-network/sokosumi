import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostAblyToken from "./ably-token/post.js";

const app = new OpenAPIHonoWithAuth();

mountPostAblyToken(app);

export default app;
