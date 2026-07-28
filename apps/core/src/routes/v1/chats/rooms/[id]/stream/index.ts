import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetRoomStreamMessages from "./get.js";
import mountPostRoomStream from "./post.js";
import mountStreamGetRoomStream from "./stream-get.js";

export default function mountRoomStream(app: OpenAPIHonoWithAuth) {
  mountGetRoomStreamMessages(app);
  mountStreamGetRoomStream(app);
  mountPostRoomStream(app);
}
