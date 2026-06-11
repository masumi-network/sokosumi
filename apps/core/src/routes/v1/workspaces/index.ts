import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetWorkspaceDesignMd from "./design-md/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetWorkspaceDesignMd(app);

export default app;
