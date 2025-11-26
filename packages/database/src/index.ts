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
 * ### Import the Prisma client singleton:
 * ```typescript
 * import prisma from '@sokosumi/database/client'
 * ```
 *
 * ### Import transaction utilities:
 * ```typescript
 * import { transaction, type TransactionClient } from '@sokosumi/database/transaction'
 * ```
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

// Export browser-safe types (includes Prisma namespace, model types, and all enums - no PrismaClient)
export * from "./generated/prisma/browser.js";

// Explicitly re-export Prisma namespace for better discoverability
export type { Prisma } from "./generated/prisma/browser.js";

// Export additional model-related types
export * from "./generated/prisma/models.js";

// Export shared types
export * from "./types/agent.js";
export * from "./types/agentList.js";
export * from "./types/agentRating.js";
export * from "./types/invitation.js";
export * from "./types/job.js";
export * from "./types/job-schedule.js";
export * from "./types/job-share.js";
export * from "./types/member.js";
export * from "./types/organization.js";
export * from "./types/utm.js";
