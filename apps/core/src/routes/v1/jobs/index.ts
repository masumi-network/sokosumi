import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetBlobsByJobId from "./[id]/files/get.js";
import mountGetJobById from "./[id]/get.js";
import mountGetJobs from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetJobs(app);
mountGetJobById(app);
mountGetBlobsByJobId(app);

export default app;
