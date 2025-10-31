/**
 * This migration adds an organization to the user who is not connected with any member.
 * For each user without member, this function:
 * - Creates an organization from user's email domain (if there is no organization with that domain)
 * - Creates a member with that created organization and connect it to the user
 */
export {};
//# sourceMappingURL=data-migration.d.ts.map