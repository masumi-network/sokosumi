import { sendGTMEvent } from "@next/third-parties/google";

import type { GTMEvent } from "./types";

export function fireEvent(event: GTMEvent) {
  if (typeof window !== "undefined") {
    sendGTMEvent(event);
  }
}
