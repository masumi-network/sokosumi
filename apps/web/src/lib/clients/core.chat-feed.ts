import {
  getChatsFeed as coreGetChatsFeed,
  type GetChatsFeedData,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

export function createChatFeedClient(getClient: GetCoreClient) {
  return {
    getChatFeed(query?: GetChatsFeedData["query"]) {
      return executeCoreOperation(
        getClient,
        (client) => coreGetChatsFeed({ client, query, cache: "no-store" }),
        "Failed to load the chat feed",
      );
    },
  };
}
