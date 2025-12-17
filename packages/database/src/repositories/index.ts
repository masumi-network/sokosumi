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

export * from "./agent.repository.js";
export * from "./agentList.repository.js";
export * from "./agentRating.repository.js";
export * from "./blob.repository.js";
export * from "./category.repository.js";
export * from "./creditCost.repository.js";
export * from "./creditTransaction.repository.js";
export * from "./fiatTransaction.repository.js";
export * from "./invitation.repository.js";
export * from "./job.repository.js";
export * from "./job-input.repository.js";
export * from "./job-purchase.repository.js";
export * from "./job-schedule.repository.js";
export * from "./job-share.repository.js";
export * from "./job-event.repository.js";
export * from "./link.repository.js";
export * from "./lock.repository.js";
export * from "./member.repository.js";
export * from "./organization.repository.js";
export * from "./tag.repository.js";
export * from "./user.repository.js";
export * from "./utmAttribution.repository.js";
