"use server";

import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface PreviewParams extends AuthenticatedRequest {
  projectId: string;
  postId: string;
}

export const loadSocialCalendarPreview = withSession(
  async ({ projectId, postId }: PreviewParams) => {
    // Listing connections also fills in missing profile pictures before the post is read.
    const connections = await projectService.listSocialConnections(projectId);
    const post = await projectService.getSocialPost(projectId, postId);
    if (!post) throw new Error("Social post not found");
    const [project, queueSlots] = await Promise.all([
      projectService.getProjectById(projectId),
      projectService.listSocialQueueSlots(projectId),
    ]);
    return {
      post,
      // A CMO Project's posts are read-only outside CMO, as on its own page.
      // A Project that cannot be read offers no actions either.
      readOnly: project?.cmo ?? true,
      queueSlots: queueSlots?.slots,
      connections: connections.filter(
        (connection) => connection.status === "active",
      ),
    };
  },
);
