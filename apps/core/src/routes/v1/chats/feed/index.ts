import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetChatFeed from "./get.js";

/** The Feed: one list of the chat messages that need the viewer. */
const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountGetChatFeed(app);

export default app;
