/**
 * @sokosumi/database/helpers
 *
 * Domain helper functions and utilities for database operations.
 * These helpers work exclusively with database types.
 *
 * ## Usage:
 *
 * ### Import helpers:
 * ```typescript
 * import {
 *   computeJobStatus,
 *   mapJobWithStatus,
 *   isPaidJob,
 *   isFreeJob,
 *   isDemoJob
 * } from '@sokosumi/database/helpers'
 * ```
 *
 * ### Job Status Computation:
 * ```typescript
 * const status = computeJobStatus(job);
 * ```
 *
 * ### Job Type Guards:
 * ```typescript
 * if (isPaidJob(job)) {
 *   // job is typed as PaidJobWithStatus
 * }
 * ```
 */

export * from "./ably.js";
export * from "./credit.js";
export * from "./job.js";
export * from "./job-sync.js";
export * from "./workspace.js";
export * from "./workspace-read-scope.js";
