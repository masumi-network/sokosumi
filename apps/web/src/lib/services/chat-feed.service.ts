import type { ChatFeed } from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

/**
 * The reader's Feed: chat messages across every room they belong to, newest
 * first. Every read is the viewer's own and is never cached across requests.
 */
export const chatFeedService = {
  async getPage(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<ChatFeed> {
    return (await coreClient.getChatFeed(options)).data;
  },
};
