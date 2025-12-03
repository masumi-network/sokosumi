import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetFilesByJobId from "./[id]/files/get.js";
import mountGetJobById from "./[id]/get.js";
import mountGetLinksByJobId from "./[id]/links/get.js";
import mountGetJobs from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetJobs(app);
mountGetJobById(app);
mountGetFilesByJobId(app);
mountGetLinksByJobId(app);

export default app;
