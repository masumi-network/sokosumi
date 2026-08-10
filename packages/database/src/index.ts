import type { PublicShare } from "./generated/prisma/browser.js";

/**
 * @sokosumi/database
 *
 * Main entry point for Prisma types, models, and enums.
 * This file exports browser-safe types to avoid Node.js dependencies in client components.
 *
 * ## Usage:
 *
 * ### Import Prisma types and models:
 * ```typescript
 * import { Prisma, Agent, User, Job } from '@sokosumi/database'
 * ```
 *
 * ### Create a Prisma client instance:
 * ```typescript
 * import { createPrismaClient } from '@sokosumi/database/client'
 *
 * const prisma = createPrismaClient(databaseUrl)
 * ```
 *
 *
 * ### Import repositories:
 * ```typescript
 * import { agentRepository, userRepository } from '@sokosumi/database/repositories'
 * ```
 *
 * ### Import helpers:
 * ```typescript
 * import { computeJobStatus, isAgentNew } from '@sokosumi/database/helpers'
 * ```
 */

export { POSTGRES_BIGINT_MAX } from "./constants.js";
// Export browser-safe types (includes Prisma namespace, model types, and all enums - no PrismaClient)
export * from "./generated/prisma/browser.js";

// Explicitly re-export Prisma namespace for better discoverability
export { Prisma } from "./generated/prisma/browser.js";

// Export additional model-related types
export * from "./generated/prisma/models.js";

// Export shared types
export * from "./types/agent.js";
export * from "./types/agentRating.js";
export * from "./types/invitation.js";
export * from "./types/job.js";
export * from "./types/member.js";
export * from "./types/organization.js";
export * from "./types/public-share.js";
export * from "./types/utm.js";
export * from "./types/workspace.js";

export type JobShare = PublicShare;
export type TaskShare = PublicShare;
