import { deleteTasksById } from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

/**
 * Task calls made straight from the browser, so they neither queue behind
 * nor re-render the page the way a server action does.
 */
export const taskClientService = {
  async archive(id: string) {
    await deleteTasksById({
      client: getBrowserCoreClient(),
      throwOnError: true,
      path: { id },
    });
  },
};
