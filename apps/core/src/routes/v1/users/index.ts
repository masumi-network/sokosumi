import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetUserFiles from "./[id]/files/get.js";
import mountGetUser from "./[id]/get.js";
import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeFiles(app);
mountGetUser(app);
mountGetUserFiles(app);

export default app;
