"use server";

import * as Sentry from "@sentry/nextjs";

import type { ActionError } from "@/lib/actions";
import {
  CoreApiRequestError,
  coreClientNoRedirect,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type {
  InstalledSkill,
  InstallSkillResponse,
  PreinstalledSkill,
  SkillCatalogDetail,
  SkillCatalogItem,
} from "@/lib/clients/generated/core";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function toActionError(error: unknown): ActionError {
  if (!(error instanceof CoreApiRequestError)) {
    Sentry.captureException(error, {
      tags: { context: "hermes_skills_action" },
    });
  }
  return toCoreApiActionError(error);
}

// A single "marketing" search returns few hits; widen across adjacent queries.
const MARKETING_QUERIES = ["marketing", "seo", "advertising", "social media"];
const MARKETING_POOL_LIMIT = 40;

export interface SkillsMarketplaceData {
  marketing: SkillCatalogItem[];
  installed: InstalledSkill[];
  preinstalled: PreinstalledSkill[];
}

/**
 * One round-trip for the whole marketplace. Next serializes concurrent server
 * actions, so issuing the catalog/installed/preinstalled fetches as separate
 * actions made the page load them one after another. Bundling them here keeps
 * it to a single action while the underlying Core calls still run in parallel.
 */
export const getSkillsMarketplaceAction = withSession<
  AuthenticatedRequest,
  Result<SkillsMarketplaceData, ActionError>
>(async () => {
  try {
    // Each call degrades to [] on its own (timeout / upstream error) so one
    // slow dependency can't blank the whole marketplace — show what resolved.
    const [marketingPool, installed, preinstalled] = await Promise.all([
      Promise.all(
        MARKETING_QUERIES.map((q) =>
          coreClientNoRedirect
            .searchSkillsCatalog({ q, limit: 20 })
            .then((r) => r.data.skills)
            .catch(() => [] as SkillCatalogItem[]),
        ),
      ),
      coreClientNoRedirect
        .getInstalledSkills()
        .then((r) => r.data.skills)
        .catch(() => [] as InstalledSkill[]),
      coreClientNoRedirect
        .getPreinstalledSkills()
        .then((r) => r.data.skills)
        .catch(() => [] as PreinstalledSkill[]),
    ]);
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
    return Ok({ marketing, installed, preinstalled });
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface BrowseSkillsArgs extends AuthenticatedRequest {
  view?: "trending" | "hot" | "all-time";
  page?: number;
  perPage?: number;
}

export const getSkillsCatalogAction = withSession<
  BrowseSkillsArgs,
  Result<SkillCatalogItem[], ActionError>
>(async ({ view, page, perPage }) => {
  try {
    const response = await coreClientNoRedirect.getSkillsCatalog({
      view,
      page,
      perPage,
    });
    return Ok(response.data.skills);
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface SearchSkillsArgs extends AuthenticatedRequest {
  q: string;
  limit?: number;
}

export const searchSkillsAction = withSession<
  SearchSkillsArgs,
  Result<SkillCatalogItem[], ActionError>
>(async ({ q, limit }) => {
  try {
    const response = await coreClientNoRedirect.searchSkillsCatalog({
      q,
      limit,
    });
    return Ok(response.data.skills);
  } catch (error) {
    return Err(toActionError(error));
  }
});

export const getCuratedSkillsAction = withSession<
  AuthenticatedRequest,
  Result<SkillCatalogItem[], ActionError>
>(async () => {
  try {
    const response = await coreClientNoRedirect.getCuratedSkills();
    return Ok(response.data.skills);
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface SkillDetailArgs extends AuthenticatedRequest {
  source: string;
  slug: string;
}

export const getSkillDetailAction = withSession<
  SkillDetailArgs,
  Result<SkillCatalogDetail, ActionError>
>(async ({ source, slug }) => {
  try {
    const response = await coreClientNoRedirect.getSkillDetail({
      source,
      slug,
    });
    return Ok(response.data);
  } catch (error) {
    return Err(toActionError(error));
  }
});

export const getInstalledSkillsAction = withSession<
  AuthenticatedRequest,
  Result<InstalledSkill[], ActionError>
>(async () => {
  try {
    const response = await coreClientNoRedirect.getInstalledSkills();
    return Ok(response.data.skills);
  } catch (error) {
    return Err(toActionError(error));
  }
});

export const getPreinstalledSkillsAction = withSession<
  AuthenticatedRequest,
  Result<PreinstalledSkill[], ActionError>
>(async () => {
  try {
    const response = await coreClientNoRedirect.getPreinstalledSkills();
    return Ok(response.data.skills);
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface InstallSkillArgs extends AuthenticatedRequest {
  source: string;
  slug: string;
}

export const installSkillAction = withSession<
  InstallSkillArgs,
  Result<InstallSkillResponse, ActionError>
>(async ({ source, slug }) => {
  try {
    const response = await coreClientNoRedirect.installSkill({ source, slug });
    return Ok(response.data);
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface RemoveSkillArgs extends AuthenticatedRequest {
  slug: string;
}

export const removeSkillAction = withSession<
  RemoveSkillArgs,
  Result<true, ActionError>
>(async ({ slug }) => {
  try {
    await coreClientNoRedirect.removeSkill(slug);
    return Ok(true);
  } catch (error) {
    return Err(toActionError(error));
  }
});
