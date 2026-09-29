import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteSession } from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { taskService } from "@/lib/services/task.service";

const inputSchema = z.object({
  name: z.string().max(300).optional(),
  description: z.string().max(8000).nullable().optional(),
});

// A background suggestion must never occupy Next's mutation action queue.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    !request.headers.get("content-type")?.includes("application/json")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const session = await readRouteSession();
    if (session.status !== "authenticated") {
      return NextResponse.json(
        { error: "Unavailable" },
        { status: session.status === "signedOut" ? 401 : 503 },
      );
    }
    const parsed = inputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const result = await taskService.suggestTaskTags(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const retryAfterSeconds =
      error instanceof CoreApiRequestError
        ? (error.retryAfterSeconds ?? 30)
        : 30;
    return NextResponse.json(
      { error: "Suggestions unavailable", retryAfterSeconds },
      {
        status:
          error instanceof CoreApiRequestError && error.status === 429
            ? 429
            : 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }
}
