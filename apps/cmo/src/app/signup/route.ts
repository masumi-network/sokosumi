import { getAuth, sokosumiSignInRedirect } from "../../lib/auth";

/** Create account from a link, such as a button on cmo.xyz or an email. */
export function GET(request: Request): Promise<Response> {
  return sokosumiSignInRedirect(getAuth(), request, { createAccount: true });
}
