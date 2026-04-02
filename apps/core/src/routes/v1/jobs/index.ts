import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetEventsByJobId from "./[id]/events/get.js";
import mountGetFilesByJobId from "./[id]/files/get.js";
import mountGetJobById from "./[id]/get.js";
import mountGetInputRequestByJobId from "./[id]/input-request/get.js";
import mountPostInputsByJobId from "./[id]/inputs/post.js";
import mountGetLinksByJobId from "./[id]/links/get.js";
import mountDeleteJobShareById from "./[id]/share/delete.js";
import mountPutJobShareById from "./[id]/share/put.js";
import mountPutJobWorkspaceById from "./[id]/workspace/put.js";
import mountGetJobs from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetJobs(app);
mountGetJobById(app);
mountGetFilesByJobId(app);
mountGetLinksByJobId(app);
mountGetInputRequestByJobId(app);
mountPostInputsByJobId(app);
mountGetEventsByJobId(app);
mountPutJobShareById(app);
mountDeleteJobShareById(app);
mountPutJobWorkspaceById(app);

export default app;
