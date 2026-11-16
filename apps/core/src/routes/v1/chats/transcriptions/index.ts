import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountPost from "./post.js";

const app = new OpenAPIHonoWithAuth();
mountPost(app);
export default app;
