import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetJobById from "./[id]/get.js";
import mountGetJobs from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetJobs(app);
mountGetJobById(app);

export default app;
