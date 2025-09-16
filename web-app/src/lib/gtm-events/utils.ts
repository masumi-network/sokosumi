import { sendGTMEvent } from "@/components/gtm";

import { GTMEvent } from "./types";

export function fireEvent(event: GTMEvent) {
  if (typeof window !== "undefined") {
    sendGTMEvent(event);
  }
}
