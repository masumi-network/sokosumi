import {
  type GetProjectsByIdImageStudioTalkingVideosData,
  getProjectsByIdImageStudioTalkingVideos,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

export function createStudioHistoryClient(getClient: GetCoreClient) {
  return {
    getProjectsByIdImageStudioTalkingVideos(
      id: string,
      query?: GetProjectsByIdImageStudioTalkingVideosData["query"],
      signal?: AbortSignal,
    ) {
      return executeCoreOperation(
        getClient,
        (client) =>
          getProjectsByIdImageStudioTalkingVideos({
            client,
            path: { id },
            query,
            signal,
            cache: "no-store",
          }),
        "Failed to fetch the Project's talking videos",
      );
    },
  };
}
