import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountCreateAblyToken from "./token/post.js";

const app = new OpenAPIHonoWithAuth();

mountCreateAblyToken(app);

export default app;
