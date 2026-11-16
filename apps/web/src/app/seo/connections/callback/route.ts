import { CROSS_ORIGIN_OPENER_POLICY } from "@/config/document-security-headers";
import {
  readSeoConnectionCallback,
  SEO_CONNECTION_HANDOFF_PREFIX,
  SEO_CONNECTION_RETURN_PATH,
} from "@/lib/seo/connection-callback";

/** Keep one-use provider sessions outside the app layout, analytics, and referrers. */
export function GET(request: Request) {
  const context = readSeoConnectionCallback(new URL(request.url).searchParams);
  const handoff = context
    ? SEO_CONNECTION_HANDOFF_PREFIX + JSON.stringify(context)
    : "";
  const safe = JSON.stringify(handoff).replace(/</g, "\\u003c");
  const script = `try{window.name=${safe};}catch(e){}window.location.replace(${JSON.stringify(SEO_CONNECTION_RETURN_PATH)});`;
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SEO</title></head><body><script>${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Opener-Policy": CROSS_ORIGIN_OPENER_POLICY,
      },
    },
  );
}
