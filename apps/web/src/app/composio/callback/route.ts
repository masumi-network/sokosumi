import { CROSS_ORIGIN_OPENER_POLICY } from "@/config/document-security-headers";
import { buildComposioCallbackInlineScript } from "@/lib/composio/oauth-popup-protocol";

/**
 * Composio OAuth popup callback. Returns minimal HTML with a synchronous
 * inline script so the popup delivers its result and closes before any app
 * chrome (root layout, CSS, React) can paint.
 *
 * Route handlers are not wrapped by `layout.tsx`, which is intentional here.
 */
export function GET() {
  const script = buildComposioCallbackInlineScript();
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
