/**
 * Membership row for route tests whose caller is a member throughout.
 *
 * `organizationContextMiddleware` reads `prisma.member.findUnique` on every
 * request that carries an organization, so a route test that mocks Prisma must
 * answer it. This stub always answers "still a member"; a test that exercises
 * the removal path needs its own `vi.fn()` instead.
 */
export async function stubMemberFindUnique(): Promise<{ id: string }> {
  return { id: "member_test" };
}
