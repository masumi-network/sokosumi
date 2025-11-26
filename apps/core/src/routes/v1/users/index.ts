import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetUser from "./[id]/get";
import mountGetMe from "./me/get";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetUser(app);

export default app;
