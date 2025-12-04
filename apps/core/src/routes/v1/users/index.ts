import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetUserFiles from "./[id]/files/get.js";
import mountGetUser from "./[id]/get.js";
import mountGetUserLinks from "./[id]/links/get.js";
import mountGetMeFiles from "./me/files/get.js";
import mountGetMe from "./me/get.js";
import mountGetMeLinks from "./me/links/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeFiles(app);
mountGetMeLinks(app);
mountGetUser(app);
mountGetUserFiles(app);
mountGetUserLinks(app);

export default app;
