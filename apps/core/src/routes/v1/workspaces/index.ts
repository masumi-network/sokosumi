import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetWorkspaceById from "./[id]/get.js";
import mountGetWorkspaceDesignMd from "./design-md/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetWorkspaceDesignMd(app);
mountGetWorkspaceById(app);

export default app;
