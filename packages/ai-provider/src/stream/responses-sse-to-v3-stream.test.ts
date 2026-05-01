import { describe, expect, it, vi } from "vitest";

import { createResponsesSseToV3Stream } from "./responses-sse-to-v3-stream.js";

function encodeSse(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.join("\n") + "\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("createResponsesSseToV3Stream", () => {
  it("does not emit synthetic prelude reasoning (avoids UIMessage start/end mismatch)", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_1"}}',
      'data: {"type":"response.output_text.delta","delta":"Hi"}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_1"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, { warnings: [] });
    const reader = stream.getReader();
    const reasoningIds = new Set<string>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        (value as { type: string }).type === "reasoning-start" &&
        typeof (value as { id?: string }).id === "string"
      ) {
        reasoningIds.add((value as { id: string }).id);
      }
    }

    expect(reasoningIds.has("sokosumi-prelude")).toBe(false);
  });

  it("recognizes response.created from JSON when event: line is omitted (response-metadata)", async () => {
    const body = encodeSse([
      'data: {"type":"response.created","response":{"id":"resp_2"}}',
      'data: {"type":"response.output_text.delta","delta":"x"}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, { warnings: [] });
    const reader = stream.getReader();
    let sawMetadata = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        (value as { type: string }).type === "response-metadata" &&
        (value as { id?: string }).id === "resp_2"
      ) {
        sawMetadata = true;
        break;
      }
    }
    expect(sawMetadata).toBe(true);
  });

  it("handles reasoning after text has started (interleaved SSE)", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_3"}}',
      'data: {"type":"response.output_text.delta","delta":"Hi"}',
      'data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_1"}}',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_1"}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_3"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, { warnings: [] });
    const reader = stream.getReader();
    const parts: { type: string; id?: string }[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || typeof value !== "object" || !("type" in value)) continue;
      const v = value as { type: string; id?: string };
      if (
        v.type === "reasoning-start" ||
        v.type === "reasoning-end" ||
        v.type === "text-start"
      ) {
        parts.push({ type: v.type, id: v.id });
      }
    }

    const textStartIdx = parts.findIndex((p) => p.type === "text-start");
    const rsStartIdx = parts.findIndex(
      (p) => p.type === "reasoning-start" && p.id === "rs_1",
    );
    const rsEndIdx = parts.findIndex(
      (p) => p.type === "reasoning-end" && p.id === "rs_1",
    );
    expect(textStartIdx).toBeGreaterThanOrEqual(0);
    expect(rsStartIdx).toBeGreaterThanOrEqual(0);
    expect(rsEndIdx).toBeGreaterThan(rsStartIdx);
    expect(rsStartIdx).toBeGreaterThan(textStartIdx);
  });

  it("awaits async onResponseCompleted before emitting finish", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_gate"}}',
      'data: {"type":"response.output_text.delta","delta":"Hi"}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_gate"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, {
      warnings: [],
      onResponseCompleted: async (id) => {
        expect(id).toBe("resp_gate");
        order.push("cb-start");
        await gate;
        order.push("cb-end");
      },
    });

    const reader = stream.getReader();
    const consumer = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          (value as { type: string }).type === "finish"
        ) {
          order.push("finish");
          break;
        }
      }
    })();

    await vi.waitFor(() => {
      expect(order).toContain("cb-start");
    });
    expect(order).not.toContain("finish");

    release();
    await consumer;

    expect(order).toEqual(["cb-start", "cb-end", "finish"]);
  });

  it("awaits async onResponseStarted before processing response.completed", async () => {
    const order: string[] = [];
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_start_gate"}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_start_gate"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, {
      warnings: [],
      onResponseStarted: async () => {
        order.push("started-begin");
        await startGate;
        order.push("started-end");
      },
      onResponseCompleted: async () => {
        order.push("completed");
      },
    });

    const reader = stream.getReader();
    const consumer = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          (value as { type: string }).type === "finish"
        ) {
          order.push("finish");
          break;
        }
      }
    })();

    await vi.waitFor(() => {
      expect(order).toContain("started-begin");
    });
    expect(order).not.toContain("completed");

    releaseStart();
    await consumer;

    expect(order).toEqual([
      "started-begin",
      "started-end",
      "completed",
      "finish",
    ]);
  });

  it("invokes onResponseCompleted with last response id when completion payload omits id", async () => {
    const completedIds: string[] = [];

    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_tail_id"}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed"}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, {
      warnings: [],
      onResponseCompleted: async (id) => {
        completedIds.push(id);
      },
    });

    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        (value as { type: string }).type === "finish"
      ) {
        break;
      }
    }

    expect(completedIds).toEqual(["resp_tail_id"]);
  });

  it("emits image generation tool results as markdown image text", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_image"}}',
      'data: {"type":"response.output_text.delta","delta":"Here is the image:"}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call_output","output":{"status":"ok","imageUrl":"https://example.com/generated.png"}}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_image"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, { warnings: [] });
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        (value as { type: string }).type === "text-delta"
      ) {
        text += (value as { delta?: string }).delta ?? "";
      }
    }

    expect(text).toContain("Here is the image:");
    expect(text).toContain(
      "![Generated image](https://example.com/generated.png)",
    );
  });

  it("emits image generation tool results when output is a JSON string", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_image_string"}}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call_output","output":"{\\"status\\":\\"ok\\",\\"imageUrl\\":\\"https://example.com/generated-string.png\\"}"}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_image_string"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV3Stream(body, { warnings: [] });
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        (value as { type: string }).type === "text-delta"
      ) {
        text += (value as { delta?: string }).delta ?? "";
      }
    }

    expect(text).toContain(
      "![Generated image](https://example.com/generated-string.png)",
    );
  });
});
