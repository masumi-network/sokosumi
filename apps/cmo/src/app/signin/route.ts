import { getAuth, sokosumiSignInRedirect } from "../../lib/auth";

/** Sign in from a link, such as a button on cmo.xyz or an email. */
export function GET(request: Request): Promise<Response> {
  return sokosumiSignInRedirect(getAuth(), request, { createAccount: false });
}
