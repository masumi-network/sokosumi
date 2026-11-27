import "server-only";

import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { unstable_rethrow } from "next/navigation";

import { coreClient } from "@/lib/clients/core.client";

export type PreprodAccessTarget =
  | { type: "user"; id: string }
  | { type: "organization"; slug: string };

/**
 * `missing`: Core has no such user or Organization. `unavailable`: Core did
 * not answer the read; the page still shows everything else.
 */
export type PreprodAccessRead =
  | { status: "found"; access: AdminPreprodAccess }
  | { status: "missing" }
  | { status: "unavailable" };

export const adminPreprodAccessService = {
  async read(target: PreprodAccessTarget): Promise<PreprodAccessRead> {
    try {
      const access =
        target.type === "user"
          ? await coreClient.getAdminUserPreprodAccess(target.id)
          : await coreClient.getAdminOrganizationPreprodAccess(target.slug);
      return access ? { status: "found", access } : { status: "missing" };
    } catch (error) {
      // A sign-in redirect from the Core client still leaves the page.
      unstable_rethrow(error);
      return { status: "unavailable" };
    }
  },

  async set(
    target: PreprodAccessTarget,
    body: { enabled: boolean; reason: string },
  ): Promise<AdminPreprodAccess> {
    return target.type === "user"
      ? await coreClient.setAdminUserPreprodAccess(target.id, body)
      : await coreClient.setAdminOrganizationPreprodAccess(target.slug, body);
  },
};
