import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostRoomStream from "./post.js";

export default function mountRoomStream(app: OpenAPIHonoWithAuth) {
  mountPostRoomStream(app);
}
