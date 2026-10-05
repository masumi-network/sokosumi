/**
 * The `error` codes CMO itself puts on `/`, beside the ones Sokosumi's OAuth
 * flow sends back. The signed-out page explains each one.
 */
export const CMO_SIGN_IN_ERROR = {
  /** Sign in could not start: Core is down or its discovery failed. */
  unavailable: "unavailable",
  /** Renewal ended the session: a ban, a revoked token, a failed refresh. */
  signedOut: "signed_out",
} as const;
