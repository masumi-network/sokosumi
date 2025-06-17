import { NextRequest } from "next/server";

import { initJobStatusListener, subscribeConnection } from "@/lib/db/listener";

export async function GET(req: NextRequest) {
  await initJobStatusListener();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        controller.enqueue(new TextEncoder().encode(data));
      };

      // Subscribe this client
      const unsubscribe = await subscribeConnection(send);

      req.signal.addEventListener("abort", unsubscribe);
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
