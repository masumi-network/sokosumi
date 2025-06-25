import { NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth";
import { initJobStatusListener, subscribeConnection } from "@/lib/db/listener";
import { payloadSchema } from "@/lib/db/listener/schema";

const KEEP_ALIVE_INTERVAL = 10000;

export async function GET(req: NextRequest) {
  await initJobStatusListener();

  const session = await auth.api.getSession(req);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const user = session.user;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => {
        // parse data
        try {
          const parsed = payloadSchema.parse(JSON.parse(payload));
          if ("userId" in parsed && parsed.userId !== user.id) {
            // only notify when user id matches
            return;
          }
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        } catch (error) {
          console.error("🔔 Invalid Job Status notification payload", error);
        }
      };

      // Subscribe this client
      const unsubscribe = subscribeConnection(send);

      // send date string to keep connection alive
      const intervalId = setInterval(
        () => send(JSON.stringify({ now: new Date().toISOString() })),
        KEEP_ALIVE_INTERVAL,
      );

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(intervalId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
