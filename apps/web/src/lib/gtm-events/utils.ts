import { sendGTMEvent } from "@next/third-parties/google";

import { GTMEvent } from "./types";

export function fireEvent(event: GTMEvent) {
  if (typeof window !== "undefined") {
    sendGTMEvent(event);
  }
}
