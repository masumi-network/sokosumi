"use server";

import * as Sentry from "@sentry/nextjs";

import type { ActionError } from "@/lib/actions";
import {
  CoreApiRequestError,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type {
  InstalledSkill,
  InstallSkillResponse,
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
    const response = await coreClient.getSkillsCatalog({ view, page, perPage });
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
    const response = await coreClient.searchSkillsCatalog({ q, limit });
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
    const response = await coreClient.getCuratedSkills();
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
    const response = await coreClient.getSkillDetail({ source, slug });
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
    const response = await coreClient.getInstalledSkills();
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
    const response = await coreClient.installSkill({ source, slug });
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
    await coreClient.removeSkill(slug);
    return Ok(true);
  } catch (error) {
    return Err(toActionError(error));
  }
});
