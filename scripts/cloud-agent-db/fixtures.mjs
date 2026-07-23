/** Known Cloud-agent login fixtures (agent Neon branches only). */

export const FIXTURE_PASSWORD = "Password123!";

/**
 * @typedef {{ email: string, name: string, role: string }} AuthFixture
 */

/** @type {AuthFixture[]} */
export const AUTH_FIXTURES = [
  {
    email: "admin@sokosumi.test",
    name: "Admin Agent",
    role: "admin",
  },
  {
    email: "alice@sokosumi.test",
    name: "Alice Agent",
    role: "user",
  },
  {
    email: "bob@sokosumi.test",
    name: "Bob Agent",
    role: "user",
  },
];
