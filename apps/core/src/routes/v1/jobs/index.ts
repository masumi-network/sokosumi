import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetJobs from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetJobs(app);

export default app;
