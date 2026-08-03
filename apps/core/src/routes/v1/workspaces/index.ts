import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetWorkspaceById from "./[id]/get.js";
import mountPostWorkspaceDesignMdAdHoc from "./design-md/adhoc/post.js";
import mountGetWorkspaceDesignMd from "./design-md/get.js";

const app = new OpenAPIHonoWithAuth();

mountPostWorkspaceDesignMdAdHoc(app);
mountGetWorkspaceDesignMd(app);
mountGetWorkspaceById(app);

export default app;
