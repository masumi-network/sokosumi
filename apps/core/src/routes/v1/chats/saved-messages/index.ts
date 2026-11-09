import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteChatSavedMessage from "./[messageId]/delete.js";
import mountPutChatSavedMessage from "./[messageId]/put.js";
import mountGetChatSavedMessages from "./get.js";

/** The reader's own Saved list: messages they keep for later. */
const app = new OpenAPIHonoWithAuth();

mountGetChatSavedMessages(app);
mountPutChatSavedMessage(app);
mountDeleteChatSavedMessage(app);

export default app;
