/** Sends a signed-out person to sign in, then back to `returnTo`. */
export function signInAgain(
  returnTo = window.location.pathname + window.location.search,
) {
  window.location.assign(`/signin?returnUrl=${encodeURIComponent(returnTo)}`);
}
