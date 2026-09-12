import { describe, expect, it } from "vitest";

import { createClient } from "@/lib/clients/generated/core/client";
import { deleteTasksByIdSchedule } from "@/lib/clients/generated/core/sdk.gen";

describe("core DELETE schedule preconditions (real client)", () => {
  it("forwards the custom header through the generated client", async () => {
    const seen: { headers: Headers; method?: string }[] = [];
    const client = createClient({
      baseUrl: "https://core.test",
      fetch: (_input, init) => {
        seen.push({
          headers: new Headers(init?.headers as HeadersInit),
          method: init?.method,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {},
              meta: { timestamp: new Date().toISOString() },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      },
    });

    await deleteTasksByIdSchedule({
      client,
      path: { id: "task-1" },
      headers: {
        "idempotency-key": "123e4567-e89b-42d3-a456-426614174000",
        "x-schedule-revision": "3",
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("DELETE");
    expect(seen[0].headers.get("x-schedule-revision")).toBe("3");
    expect(seen[0].headers.get("idempotency-key")).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
  });
});
