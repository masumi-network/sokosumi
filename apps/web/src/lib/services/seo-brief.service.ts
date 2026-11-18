import "server-only";

import {
  getProjectSeoBrief,
  getSeoAuditBrief,
  type SaveSeoAuditBriefRequest,
  saveProjectSeoBrief,
  saveSeoAuditBrief,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";
import type { SeoOwner } from "@/lib/seo/owner";

export const seoBriefService = {
  async read(owner: SeoOwner) {
    const operation =
      owner.kind === "audit" ? getSeoAuditBrief : getProjectSeoBrief;
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => operation({ client, path: { id: owner.id } }),
      "Failed to read your SEO brief",
    );
    return response.data;
  },
  async save(owner: SeoOwner, body: SaveSeoAuditBriefRequest) {
    const operation =
      owner.kind === "audit" ? saveSeoAuditBrief : saveProjectSeoBrief;
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => operation({ client, path: { id: owner.id }, body }),
      "Failed to save your SEO brief",
    );
    return response.data;
  },
};
