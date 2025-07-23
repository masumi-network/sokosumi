import { Tag } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class TagService extends BaseService<TagService> {
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
