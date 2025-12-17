import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetFilesByJobId from "./[id]/files/get.js";
import mountGetJobById from "./[id]/get.js";
import mountProvideJobInput from "./[id]/input/post.js";
import mountGetInputRequestByJobId from "./[id]/input_request/get.js";
import mountGetLinksByJobId from "./[id]/links/get.js";
import mountGetStatusesByJobId from "./[id]/statuses/get.js";
import mountGetJobs from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetJobs(app);
mountGetJobById(app);
mountGetFilesByJobId(app);
mountGetLinksByJobId(app);
mountGetInputRequestByJobId(app);
mountProvideJobInput(app);
mountGetStatusesByJobId(app);

export default app;
