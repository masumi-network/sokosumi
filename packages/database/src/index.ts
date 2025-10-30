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
export * from "./generated/prisma/browser";

// Explicitly re-export Prisma namespace for better discoverability
export type { Prisma } from "./generated/prisma/browser";

// Export additional model-related types
export * from "./generated/prisma/models";

// Export shared types
export * from "./types/agent";
export * from "./types/agentList";
export * from "./types/agentRating";
export * from "./types/invitation";
export * from "./types/job";
export * from "./types/job-schedule";
export * from "./types/job-share";
export * from "./types/member";
export * from "./types/organization";
export * from "./types/utm";
