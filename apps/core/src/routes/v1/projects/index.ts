import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetProjectCalendar from "./[id]/calendar/get.js";
import mountProjectCloseRoutes from "./[id]/close/routes.js";
import mountGetProjectContextMd from "./[id]/context-md/get.js";
import mountDeleteProject from "./[id]/delete.js";
import mountDeleteProjectDesignMd from "./[id]/design-md/delete.js";
import mountPutProjectDesignMd from "./[id]/design-md/put.js";
import mountGetProject from "./[id]/get.js";
import mountDeleteProjectJob from "./[id]/jobs/[jobId]/delete.js";
import mountPostProjectJob from "./[id]/jobs/post.js";
import mountGetProjectNeedsAttention from "./[id]/needs-attention/get.js";
import mountPatchProject from "./[id]/patch.js";
import mountDeleteProjectSocialConnection from "./[id]/social-connections/[connectionId]/delete.js";
import mountFinalizeProjectSocialConnection from "./[id]/social-connections/finalize/post.js";
import mountListProjectSocialConnections from "./[id]/social-connections/get.js";
import mountInitiateProjectSocialConnection from "./[id]/social-connections/initiate/post.js";
import mountCancelProjectSocialPost from "./[id]/social-posts/[postId]/cancel/post.js";
import mountGetProjectSocialPost from "./[id]/social-posts/[postId]/get.js";
import mountPatchProjectSocialPost from "./[id]/social-posts/[postId]/patch.js";
import mountPublishProjectSocialPost from "./[id]/social-posts/[postId]/publish/post.js";
import mountScheduleProjectSocialPost from "./[id]/social-posts/[postId]/schedule/post.js";
import mountListProjectSocialPosts from "./[id]/social-posts/get.js";
import mountCreateProjectSocialPost from "./[id]/social-posts/post.js";
import mountDeleteProjectStar from "./[id]/star/delete.js";
import mountPostProjectStar from "./[id]/star/post.js";
import mountDeleteProjectTask from "./[id]/tasks/[taskId]/delete.js";
import mountPostProjectTask from "./[id]/tasks/post.js";
import mountListProjects from "./get.js";
import mountPostProject from "./post.js";
import mountGetStarredProjects from "./starred/get.js";
import mountGetProjectStats from "./stats/get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountListProjects(app);
mountPostProject(app);
mountGetProjectStats(app);
mountGetStarredProjects(app);
mountPostProjectJob(app);
mountDeleteProjectJob(app);
mountPostProjectTask(app);
mountDeleteProjectTask(app);
mountGetProjectContextMd(app);
mountPutProjectDesignMd(app);
mountDeleteProjectDesignMd(app);
mountGetProjectCalendar(app);
mountProjectCloseRoutes(app);
mountGetProjectNeedsAttention(app);
mountPostProjectStar(app);
mountDeleteProjectStar(app);
mountListProjectSocialConnections(app);
mountInitiateProjectSocialConnection(app);
mountFinalizeProjectSocialConnection(app);
mountDeleteProjectSocialConnection(app);
mountListProjectSocialPosts(app);
mountCreateProjectSocialPost(app);
mountGetProjectSocialPost(app);
mountPatchProjectSocialPost(app);
mountScheduleProjectSocialPost(app);
mountPublishProjectSocialPost(app);
mountCancelProjectSocialPost(app);
mountGetProject(app);
mountPatchProject(app);
mountDeleteProject(app);

export default app;
