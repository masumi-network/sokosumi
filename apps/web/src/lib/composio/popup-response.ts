import { CROSS_ORIGIN_OPENER_POLICY } from "@/config/document-security-headers";

export function popupResponse(script: string) {
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
