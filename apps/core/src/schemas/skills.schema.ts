import { z } from "@hono/zod-openapi";

// Skills marketplace (skills.sh) — request/response schemas for the Core API
// the web app consumes. Catalog endpoints proxy skills.sh; install/list/remove
// proxy the orchestrator. Files are fetched + audited server-side at install
// time, so they never cross to the client here.

export const skillsRiskLevelSchema = z
  .enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
  .openapi("SkillsRiskLevel");

export const skillsAuditStatusSchema = z
  .enum(["pass", "warn", "fail"])
  .openapi("SkillsAuditStatus");

export const skillsLeaderboardViewSchema = z.enum([
  "trending",
  "hot",
  "all-time",
]);

export const skillCatalogItemSchema = z
  .object({
    skillId: z.string(),
    source: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    installs: z.number().int().nullable(),
    curated: z.boolean(),
  })
  .openapi("SkillCatalogItem");

export const skillCatalogListSchema = z
  .object({ skills: z.array(skillCatalogItemSchema) })
  .openapi("SkillCatalogList");

export const skillAuditEntrySchema = z
  .object({
    provider: z.string(),
    status: skillsAuditStatusSchema,
    riskLevel: skillsRiskLevelSchema,
  })
  .openapi("SkillAuditEntry");

export const skillCatalogDetailSchema = skillCatalogItemSchema
  .extend({
    hash: z.string().nullable(),
    installUrl: z.string().nullable(),
    /** Worst risk across audit providers; null when unaudited. */
    auditRisk: skillsRiskLevelSchema.nullable(),
    audits: z.array(skillAuditEntrySchema),
  })
  .openapi("SkillCatalogDetail");

export const installedSkillStatusSchema = z
  .enum(["installed", "installing"])
  .openapi("InstalledSkillStatus");

export const installedSkillSchema = z
  .object({
    skillId: z.string(),
    source: z.string(),
    slug: z.string(),
    name: z.string(),
    auditRisk: skillsRiskLevelSchema.nullable(),
    status: installedSkillStatusSchema,
    installedAt: z.string().nullable(),
  })
  .openapi("InstalledSkill");

export const installedSkillsListSchema = z
  .object({ skills: z.array(installedSkillSchema) })
  .openapi("InstalledSkillsList");

// Skills baked into the Hermes image (the orchestrator's source of truth, not
// skills.sh). Shown read-only so users see what their agent already ships with.
export const preinstalledSkillSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  })
  .openapi("PreinstalledSkill");

export const preinstalledSkillsListSchema = z
  .object({ skills: z.array(preinstalledSkillSchema) })
  .openapi("PreinstalledSkillsList");

export const installSkillRequestSchema = z
  .object({
    source: z.string().min(1),
    slug: z.string().min(1),
  })
  .openapi("InstallSkillRequest");

export const installSkillResponseSchema = z
  .object({
    slug: z.string(),
    status: installedSkillStatusSchema,
  })
  .openapi("InstallSkillResponse");

export const skillsBrowseQuerySchema = z.object({
  view: skillsLeaderboardViewSchema.default("trending"),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
});

export const skillsSearchQuerySchema = z.object({
  q: z.string().min(2),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const skillsDetailQuerySchema = z.object({
  source: z.string().min(1),
  slug: z.string().min(1),
});
