import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetWorkspaceCalendar from "./[id]/calendar/get.js";
import mountGetWorkspaceById from "./[id]/get.js";
import mountGetActiveWorkspaceCalendar from "./calendar/get.js";
import mountPostWorkspaceDesignMdAdHoc from "./design-md/adhoc/post.js";
import mountGetWorkspaceDesignMd from "./design-md/get.js";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountPostWorkspaceDesignMdAdHoc(app);
mountGetWorkspaceDesignMd(app);
mountGetActiveWorkspaceCalendar(app);
mountGetWorkspaceCalendar(app);
mountGetWorkspaceById(app);

export default app;
