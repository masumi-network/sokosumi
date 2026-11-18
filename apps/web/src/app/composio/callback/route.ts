import { buildComposioCallbackInlineScript } from "@/lib/composio/oauth-popup-protocol";
import { popupResponse } from "@/lib/composio/popup-response";

/**
 * Composio OAuth popup callback. Returns minimal HTML with a synchronous
 * inline script so the popup delivers its result and closes before any app
 * chrome (root layout, CSS, React) can paint.
 *
 * Route handlers are not wrapped by `layout.tsx`, which is intentional here.
 */
export function GET() {
  return popupResponse(buildComposioCallbackInlineScript());
}
