import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostCalendarIdentityLabels from "./[id]/calendar/identity-labels/post.js";
import mountGetWorkspaceById from "./[id]/get.js";
import mountGetWorkspaceSocialPerformanceExport from "./[id]/social-performance/export/get.js";
import mountGetWorkspaceSocialPerformance from "./[id]/social-performance/get.js";
import mountGetActiveWorkspaceCalendar from "./calendar/get.js";
import mountGetWorkspaceCalendarSources from "./calendar/sources/get.js";
import mountPostWorkspaceDesignMdAdHoc from "./design-md/adhoc/post.js";
import mountGetWorkspaceDesignMd from "./design-md/get.js";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountPostWorkspaceDesignMdAdHoc(app);
mountGetWorkspaceDesignMd(app);
mountGetActiveWorkspaceCalendar(app);
mountGetWorkspaceCalendarSources(app);
mountPostCalendarIdentityLabels(app);
mountGetWorkspaceSocialPerformance(app);
mountGetWorkspaceSocialPerformanceExport(app);
mountGetWorkspaceById(app);

export default app;
