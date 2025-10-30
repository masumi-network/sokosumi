/**
 * @sokosumi/database/repositories
 *
 * Domain-specific repository layer for all database entities.
 * All repositories follow the pattern of accepting an optional TransactionClient parameter.
 *
 * ## Usage:
 *
 * ### Import repositories:
 * ```typescript
 * import { userRepository, agentRepository } from '@sokosumi/database/repositories'
 * ```
 *
 * ### Use with transactions:
 * ```typescript
 * import { transaction } from '@sokosumi/database/transaction'
 * import { userRepository, jobRepository } from '@sokosumi/database/repositories'
 *
 * await transaction.run(async (tx) => {
 *   const user = await userRepository.getUserById(userId, tx)
 *   const job = await jobRepository.createJob({ ... }, tx)
 * })
 * ```
 */

export * from "./agent.repository";
export * from "./agentList.repository";
export * from "./agentRating.repository";
export * from "./blob.repository";
export * from "./creditCost.repository";
export * from "./creditTransaction.repository";
export * from "./fiatTransaction.repository";
export * from "./invitation.repository";
export * from "./job.repository";
export * from "./job-schedule.repository";
export * from "./job-share.repository";
export * from "./link.repository";
export * from "./lock.repository";
export * from "./member.repository";
export * from "./organization.repository";
export * from "./tag.repository";
export * from "./user.repository";
export * from "./utmAttribution.repository";
