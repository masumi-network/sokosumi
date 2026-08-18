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
 *   organization?: AuthFixtureOrganization | null,
 *   createPersonalWorkspace?: boolean,
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
  {
    email: "zero@sokosumi.test",
    name: "Zero Workspace",
    role: "user",
    organization: null,
    createPersonalWorkspace: false,
  },
];

/**
 * Whether this fixture should receive a personal workspace row.
 * Defaults to true when omitted.
 * @param {AuthFixture} fixture
 */
export function fixtureWantsPersonalWorkspace(fixture) {
  return fixture.createPersonalWorkspace !== false;
}

/**
 * Whether this fixture should receive an organization + membership.
 * Defaults to true when `organization` is a non-null object.
 * @param {AuthFixture} fixture
 */
export function fixtureWantsOrganization(fixture) {
  return fixture.organization != null;
}
