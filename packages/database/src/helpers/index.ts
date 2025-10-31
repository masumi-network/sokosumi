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

export * from "./job";
