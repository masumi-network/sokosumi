import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetProjectCalendar from "./[id]/calendar/get.js";
import mountGetProjectContextMd from "./[id]/context-md/get.js";
import mountDeleteProject from "./[id]/delete.js";
import mountDeleteProjectDesignMd from "./[id]/design-md/delete.js";
import mountPutProjectDesignMd from "./[id]/design-md/put.js";
import mountGetProject from "./[id]/get.js";
import mountDeleteProjectJob from "./[id]/jobs/[jobId]/delete.js";
import mountPostProjectJob from "./[id]/jobs/post.js";
import mountPatchProject from "./[id]/patch.js";
import mountDeleteProjectSocialConnection from "./[id]/social-connections/[connectionId]/delete.js";
import mountFinalizeProjectSocialConnection from "./[id]/social-connections/finalize/post.js";
import mountListProjectSocialConnections from "./[id]/social-connections/get.js";
import mountInitiateProjectSocialConnection from "./[id]/social-connections/initiate/post.js";
import mountDeleteProjectTask from "./[id]/tasks/[taskId]/delete.js";
import mountPostProjectTask from "./[id]/tasks/post.js";
import mountListProjects from "./get.js";
import mountPostProject from "./post.js";
import mountGetProjectStats from "./stats/get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountListProjects(app);
mountPostProject(app);
mountGetProjectStats(app);
mountPostProjectJob(app);
mountDeleteProjectJob(app);
mountPostProjectTask(app);
mountDeleteProjectTask(app);
mountGetProjectContextMd(app);
mountPutProjectDesignMd(app);
mountDeleteProjectDesignMd(app);
mountGetProjectCalendar(app);
mountListProjectSocialConnections(app);
mountInitiateProjectSocialConnection(app);
mountFinalizeProjectSocialConnection(app);
mountDeleteProjectSocialConnection(app);
mountGetProject(app);
mountPatchProject(app);
mountDeleteProject(app);

export default app;
