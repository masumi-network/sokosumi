import "server-only";

import { coreClientNoRedirect } from "@/lib/clients/core.client";
import type {
  InstalledSkill,
  PreinstalledSkill,
  SkillCatalogItem,
} from "@/lib/clients/generated/core";

// A single "marketing" search returns few hits; widen across adjacent queries.
const MARKETING_QUERIES = ["marketing", "seo", "advertising", "social media"];
const MARKETING_POOL_LIMIT = 40;

export interface SkillsMarketplaceData {
  marketing: SkillCatalogItem[];
  installed: InstalledSkill[];
  preinstalled: PreinstalledSkill[];
}

/**
 * Load the bundled marketplace payload (marketing shelf + installed +
 * preinstalled). Shared by the server action and the Route Handler so the
 * client can pre-warm via `fetch` without contending for Next's per-session
 * server-action queue (wizard OAuth / other actions stay responsive).
 */
export async function loadSkillsMarketplaceData(): Promise<SkillsMarketplaceData> {
  // Marketing searches degrade individually so one slow query can't blank the
  // shelf; installed/preinstalled must succeed so we never show a false empty
  // state (Add on existing skills, missing Included shelf, removable built-ins).
  const [marketingPool, installedResponse, preinstalledResponse] =
    await Promise.all([
      Promise.all(
        MARKETING_QUERIES.map((q) =>
          coreClientNoRedirect
            .searchSkillsCatalog({ q, limit: 20 })
            .then((r) => r.data.skills)
            .catch(() => [] as SkillCatalogItem[]),
        ),
      ),
      coreClientNoRedirect.getInstalledSkills(),
      coreClientNoRedirect.getPreinstalledSkills(),
    ]);
  const installed = installedResponse.data.skills;
  const preinstalled = preinstalledResponse.data.skills;
  // Don't offer skills the agent already has (installed or image-baked).
  const have = new Set<string>([
    ...installed.map((s) => s.slug),
    ...preinstalled.map((s) => s.slug),
  ]);
  const seen = new Set<string>();
  const marketing = marketingPool
    .flat()
    .filter((s) => {
      if (have.has(s.slug) || seen.has(s.skillId)) return false;
      seen.add(s.skillId);
      return true;
    })
    .sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
    .slice(0, MARKETING_POOL_LIMIT);
  return { marketing, installed, preinstalled };
}
