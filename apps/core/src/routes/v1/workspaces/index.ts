import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetWorkspaceAdDataConsent from "./[id]/ad-data-consent/get.js";
import mountPutWorkspaceAdDataConsent from "./[id]/ad-data-consent/put.js";
import mountPostCalendarIdentityLabels from "./[id]/calendar/identity-labels/post.js";
import mountGetWorkspaceById from "./[id]/get.js";
import mountExportWorkspaceSocialAccountStatistics from "./[id]/social-connections/statistics/export/get.js";
import mountListWorkspaceSocialAccountStatistics from "./[id]/social-connections/statistics/get.js";
import mountGetActiveWorkspaceCalendar from "./calendar/get.js";
import mountGetWorkspaceCalendarSources from "./calendar/sources/get.js";
import mountPostWorkspaceDesignMdAdHoc from "./design-md/adhoc/post.js";
import mountGetWorkspaceDesignMd from "./design-md/get.js";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountGetWorkspaceAdDataConsent(app);
mountPutWorkspaceAdDataConsent(app);
mountPostWorkspaceDesignMdAdHoc(app);
mountGetWorkspaceDesignMd(app);
mountGetActiveWorkspaceCalendar(app);
mountGetWorkspaceCalendarSources(app);
mountPostCalendarIdentityLabels(app);
mountGetWorkspaceById(app);
mountListWorkspaceSocialAccountStatistics(app);
mountExportWorkspaceSocialAccountStatistics(app);

export default app;
