import { CROSS_ORIGIN_OPENER_POLICY } from "@/config/document-security-headers";
import {
  buildComposioHandoffInlineScript,
  readComposioHandoff,
} from "@/lib/composio/oauth-popup-protocol";

/**
 * A connect started in another first-party app (CMO) passes here on its way
 * to Composio: the tab remembers where to return, because Composio sends
 * every sign-in back to Web's fixed callback page.
 */
export function GET(request: Request) {
  const handoff = readComposioHandoff(new URL(request.url).searchParams);
  if (!handoff) {
    return new Response("Unknown connection", { status: 400 });
  }
  const script = buildComposioHandoffInlineScript(handoff);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body><script>${script}</script></body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cross-Origin-Opener-Policy": CROSS_ORIGIN_OPENER_POLICY,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
