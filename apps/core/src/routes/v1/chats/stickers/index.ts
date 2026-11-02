import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = new OpenAPIHonoWithAuth();
mountGet(app);
mountPost(app);
export default app;
