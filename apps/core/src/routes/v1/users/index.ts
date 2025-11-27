import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetUser from "./[id]/get.js";
import mountGetMe from "./me/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetUser(app);

export default app;
