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
    return {
      post,
      connections: connections.filter(
        (connection) => connection.status === "active",
      ),
    };
  },
);
