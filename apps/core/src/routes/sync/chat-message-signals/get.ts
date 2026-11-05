import type { Hono } from "hono";

import { sweepChatMessageSignals } from "@/services/chat-message-signals.service";

import { handleSyncRequest } from "../handler.js";

const CHAT_MESSAGE_SIGNALS_SYNC_LOCK_KEY = "chat-message-signals-sync";

/**
 * The sweep behind the live chat-signal flush: messages whose `waitUntil`
 * was lost, failures handed back, and leases a crashed batch left behind.
 */
export default function mount(app: Hono) {
  app.get("/chat-message-signals", (c) =>
    handleSyncRequest(c, CHAT_MESSAGE_SIGNALS_SYNC_LOCK_KEY, (context) =>
      sweepChatMessageSignals(context),
    ),
  );
}
