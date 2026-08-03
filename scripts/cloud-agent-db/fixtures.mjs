/** Known Cloud-agent login fixtures (agent Neon branches only). */

export const FIXTURE_PASSWORD = "Password123!";

/**
 * @typedef {{ name: string, slug: string }} AuthFixtureOrganization
 */

/**
 * @typedef {{
 *   email: string,
 *   name: string,
 *   role: string,
 *   organization: AuthFixtureOrganization,
 * }} AuthFixture
 */

/** @type {AuthFixture[]} */
export const AUTH_FIXTURES = [
  {
    email: "admin@sokosumi.test",
    name: "Admin Agent",
    role: "admin",
    organization: {
      name: "Admin Fixture Org",
      slug: "admin-fixture",
    },
  },
  {
    email: "alice@sokosumi.test",
    name: "Alice Agent",
    role: "user",
    organization: {
      name: "Alice Fixture Org",
      slug: "alice-fixture",
    },
  },
  {
    email: "bob@sokosumi.test",
    name: "Bob Agent",
    role: "user",
    organization: {
      name: "Bob Fixture Org",
      slug: "bob-fixture",
    },
  },
];
