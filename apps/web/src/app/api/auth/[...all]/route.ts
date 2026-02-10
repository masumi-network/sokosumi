import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

export const runtime = "edge";
export const preferredRegion = ["fra1", "dub1"]; // Frankfurt and Dublin

export const { POST, GET } = toNextJsHandler(auth);
