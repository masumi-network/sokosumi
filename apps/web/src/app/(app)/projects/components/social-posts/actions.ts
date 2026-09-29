"use server";

import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";
import { SECTION_STATUSES, type SectionKey } from "./constants";

interface LoadMoreSocialPostsParams extends AuthenticatedRequest {
  projectId: string;
  section: SectionKey;
  cursor: string;
}
export const loadMoreSocialPosts = withSession<
  LoadMoreSocialPostsParams,
  Awaited<ReturnType<typeof projectService.listSocialPosts>>
>(async ({ projectId, section, cursor }) => {
  if (!Object.hasOwn(SECTION_STATUSES, section))
    throw new Error("Invalid social post section");
  return projectService.listSocialPosts(projectId, {
    statuses: SECTION_STATUSES[section],
    cursor,
  });
});
