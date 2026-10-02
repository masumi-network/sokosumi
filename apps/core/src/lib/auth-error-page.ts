/**
 * Where Better Auth sends a failure that carries no error URL of its own: a
 * social callback whose state is gone, an authorize request it cannot return
 * to the client, a failed account link or proxy hand-off. Without it they land
 * on Core's `/auth/error`, which on production bounces to the API host's root.
 * Web's flows still pass their own `errorCallbackURL`, which wins.
 */
export function authErrorPageOptions(webAppBaseUrl: string) {
  return { errorURL: `${webAppBaseUrl}/auth/error` };
}
