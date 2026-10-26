import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPutChatSignalCorrection from "./messages/[messageId]/corrections/put.js";
import mountPutChatSignalLoop from "./messages/[messageId]/loop/put.js";
import mountGetChatSignalRouting from "./messages/[messageId]/routing/get.js";
import mountGetChatNeedsYou from "./needs-you/get.js";
import mountGetChatOpenLoops from "./open-loops/get.js";
import mountGetChatRoomCatchUp from "./rooms/[id]/catch-up/get.js";
import mountGetChatRoomDecisions from "./rooms/[id]/decisions/get.js";
import mountGetChatCatchUpSummary from "./summary/get.js";

/** Chat signals: what Jev reads in chat messages, and the views built on it. */
const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountGetChatNeedsYou(app);
mountGetChatOpenLoops(app);
mountGetChatCatchUpSummary(app);
mountGetChatRoomCatchUp(app);
mountGetChatRoomDecisions(app);
mountPutChatSignalCorrection(app);
mountPutChatSignalLoop(app);
mountGetChatSignalRouting(app);

export default app;
