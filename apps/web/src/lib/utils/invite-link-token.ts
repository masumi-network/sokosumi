/**
 * Extracts the capability token from whatever a user pastes into the
 * "I have an invite link" field.
 *
 * People paste the whole URL far more often than the bare token, and they
 * paste it with query strings, trailing slashes, and stray whitespace. Any
 * host is accepted: the link may come from a preview or staging deployment,
 * and the token is validated server-side regardless.
 */
export function parseOrganizationInviteToken(input: string): null | string {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const pathname = extractPathname(trimmedInput);
  const segments = pathname.split("/").filter(Boolean);
  const joinIndex = segments.lastIndexOf("join");

  // Either a link with a `/join/` segment, or a bare token on its own. Any
  // other multi-segment input is something the user pasted by mistake; reading
  // its last segment as a token would report "invite not found" for what is
  // really "that is not an invite link".
  const token =
    joinIndex === -1
      ? segments.length === 1
        ? segments[0]
        : undefined
      : segments[joinIndex + 1];

  if (!token) {
    return null;
  }

  // Tokens are URL-safe base64; anything else is a mistyped paste, not a link.
  return /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

function extractPathname(input: string): string {
  try {
    return new URL(input).pathname;
  } catch {
    // Not a URL — either a bare token or a "/join/<token>" path fragment.
    return input.split(/[?#]/)[0] ?? "";
  }
}
