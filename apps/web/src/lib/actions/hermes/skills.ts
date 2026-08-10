"use server";

import * as Sentry from "@sentry/nextjs";
import { err, ok } from "neverthrow";
import type { ActionError } from "@/lib/actions";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
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

// Marketplace catalog reads use GET /api/personal-assistant/skills-marketplace
// (Route Handler + loadSkillsMarketplaceData) so client pre-warm does not
// occupy Next's server-action queue. Mutations and search stay here as actions.

interface BrowseSkillsArgs extends AuthenticatedRequest {
  view?: "trending" | "hot" | "all-time";
  page?: number;
  perPage?: number;
}

export const getSkillsCatalogAction = withSession<
  BrowseSkillsArgs,
  ActionResultDto<SkillCatalogItem[], ActionError>
>(async ({ view, page, perPage }) => {
  try {
    const response = await coreClientNoRedirect.getSkillsCatalog({
      view,
      page,
      perPage,
    });
    return toActionResult(ok(response.data.skills));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

interface SearchSkillsArgs extends AuthenticatedRequest {
  q: string;
  limit?: number;
}

export const searchSkillsAction = withSession<
  SearchSkillsArgs,
  ActionResultDto<SkillCatalogItem[], ActionError>
>(async ({ q, limit }) => {
  try {
    const response = await coreClientNoRedirect.searchSkillsCatalog({
      q,
      limit,
    });
    return toActionResult(ok(response.data.skills));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

export const getCuratedSkillsAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<SkillCatalogItem[], ActionError>
>(async () => {
  try {
    const response = await coreClientNoRedirect.getCuratedSkills();
    return toActionResult(ok(response.data.skills));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

interface SkillDetailArgs extends AuthenticatedRequest {
  source: string;
  slug: string;
}

export const getSkillDetailAction = withSession<
  SkillDetailArgs,
  ActionResultDto<SkillCatalogDetail, ActionError>
>(async ({ source, slug }) => {
  try {
    const response = await coreClientNoRedirect.getSkillDetail({
      source,
      slug,
    });
    return toActionResult(ok(response.data));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

export const getInstalledSkillsAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<InstalledSkill[], ActionError>
>(async () => {
  try {
    const response = await coreClientNoRedirect.getInstalledSkills();
    return toActionResult(ok(response.data.skills));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

export const getPreinstalledSkillsAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<PreinstalledSkill[], ActionError>
>(async () => {
  try {
    const response = await coreClientNoRedirect.getPreinstalledSkills();
    return toActionResult(ok(response.data.skills));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

interface InstallSkillArgs extends AuthenticatedRequest {
  source: string;
  slug: string;
}

export const installSkillAction = withSession<
  InstallSkillArgs,
  ActionResultDto<InstallSkillResponse, ActionError>
>(async ({ source, slug }) => {
  try {
    const response = await coreClientNoRedirect.installSkill({ source, slug });
    return toActionResult(ok(response.data));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});

interface RemoveSkillArgs extends AuthenticatedRequest {
  slug: string;
}

export const removeSkillAction = withSession<
  RemoveSkillArgs,
  ActionResultDto<true, ActionError>
>(async ({ slug }) => {
  try {
    await coreClientNoRedirect.removeSkill(slug);
    return toActionResult(ok(true));
  } catch (error) {
    return toActionResult(err(toActionError(error)));
  }
});
