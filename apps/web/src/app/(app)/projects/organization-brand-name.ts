import "server-only";

import { unstable_rethrow } from "next/navigation";

import { designMdService } from "@/lib/services/design-md.service";

/**
 * The active organization's name when a Project without its own brand could
 * start from the organization's DESIGN.md. Null for a Project that has one, a
 * CMO Project (CMO writes its brand), a personal workspace, or a failed read:
 * the brand card then offers only its other ways.
 */
export async function organizationBrandName(project: {
  cmo: boolean;
  designMd: unknown;
}): Promise<string | null> {
  if (project.designMd || project.cmo) return null;
  const effective = await designMdService
    .resolveEffectiveDesignMd()
    .catch((error: unknown) => {
      // A Core 401 arrives as the sign-in redirect; only real failures fall back.
      unstable_rethrow(error);
      return null;
    });
  return effective?.owner.type === "organization" ? effective.owner.name : null;
}
