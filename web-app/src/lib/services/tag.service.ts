import { Tag } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

/**
 * Service for handling Tag-related database operations.
 *
 * @extends BaseService<TagService>
 */
export class TagService extends BaseService<TagService> {
  /**
   * Retrieves all active tags, defined as tags associated with at least one agent
   * or having at least one agent override. Results are ordered alphabetically by name.
   *
   * @returns A promise that resolves to an array of active Tag objects.
   */
  async getActiveTags(): Promise<Tag[]> {
    return this.client.tag.findMany({
      where: {
        OR: [{ agents: { some: {} } }, { agentsOverride: { some: {} } }],
      },
      orderBy: {
        name: "asc",
      },
    });
  }
}
