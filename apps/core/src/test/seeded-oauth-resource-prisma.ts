/**
 * `@/lib/db/prisma` for a test that boots Core's real `auth` without a
 * database. Better Auth seeds the MCP resource row when it starts (ADR 0076);
 * this answers its read and write as if the row exists, so startup does not
 * wait on a connection to the placeholder `DATABASE_URL`.
 *
 * `vi.mock("@/lib/db/prisma", () => import("@/test/seeded-oauth-resource-prisma"));`
 */
const row = (identifier: string) => ({ id: "mcp-resource", identifier });

export default {
  oauthResource: {
    findFirst: async ({ where }: { where: { identifier: string } }) =>
      row(where.identifier),
    // The seed writes the config's policy onto the row it found.
    update: async ({ where }: { where: { identifier: string } }) =>
      row(where.identifier),
  },
};
