import { buildZernioCallbackInlineScript } from "@/lib/composio/oauth-popup-protocol";
import { popupResponse } from "@/lib/composio/popup-response";

export function GET() {
  return popupResponse(buildZernioCallbackInlineScript());
}
