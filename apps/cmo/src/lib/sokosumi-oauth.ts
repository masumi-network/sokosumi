/**
 * Sign in with Sokosumi's OAuth wiring that CMO and CI share. CI adds
 * `<preview origin>${SOKOSUMI_OAUTH_CALLBACK_PATH}` to CMO's client in each
 * pull request's preview database (scripts/ci/cmo-preview-callback.ts), so
 * CMO must send exactly this callback. Plain constants only: CI runs this
 * file with Node's type stripping and no install.
 */

/** The Better Auth generic OAuth provider id for Core. */
export const SOKOSUMI_OAUTH_PROVIDER_ID = "sokosumi";

/** Better Auth's callback route for that provider under `/api/auth`. */
export const SOKOSUMI_OAUTH_CALLBACK_PATH = `/api/auth/callback/${SOKOSUMI_OAUTH_PROVIDER_ID}`;
