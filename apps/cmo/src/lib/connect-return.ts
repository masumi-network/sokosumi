/** Why a social connection came back without an account, as the callback names it. */
export type ConnectFailure = "failed" | "no_page" | "no_channel";

/** The cookie that carries a sign-in to the account picker; never in an address. */
export const CONNECT_SIGN_IN_COOKIE = "cmo-connect-sign-in";

/** What the owner reads for the `connect` marker on the return address. */
export function connectReturnError(code: string | null): string | null {
  switch (code) {
    case null:
    case "":
      return null;
    case "no_page":
      return "That Facebook login manages no Page. Connect again with the login that manages your Page.";
    case "no_channel":
      return "That Google sign-in has no YouTube channel. Connect again and pick the channel's account on Google's screen.";
    default:
      return "That connection didn't finish. Try again.";
  }
}

/** What the owner reads for the `ads` marker on the return address. */
export function adsReturnErrorFromCode(code: string | null): string | null {
  if (code === "none") {
    return "That login has no ad account. Create one in Google Ads or Meta, then connect again.";
  }
  return code === "failed"
    ? "That ad connection didn't finish. Try again."
    : null;
}

/** What the owner reads for the `measure` marker on the return address. */
export function measureReturnError(code: string | null): string | null {
  return code === "failed" ? "That connection didn't finish. Try again." : null;
}
