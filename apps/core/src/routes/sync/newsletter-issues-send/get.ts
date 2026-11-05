import type { Hono } from "hono";

import { sendDueNewsletterIssues } from "@/services/newsletter-send.service";

import { handleSyncRequest } from "../handler.js";

export default function mount(app: Hono) {
  app.get("/newsletter-issues-send", async (c) => {
    return handleSyncRequest(
      c,
      "newsletter-issues-send-sync",
      async (context) => {
        await sendDueNewsletterIssues({
          shouldContinue: context.shouldContinue,
        });
      },
    );
  });
}
