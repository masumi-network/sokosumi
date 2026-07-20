import { describe, expect, it, vi } from "vitest";

import { createResponsesSseToV4Stream } from "./responses-sse-to-v4-stream.js";

function encodeSse(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.join("\n") + "\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function collectStreamTextAndReasoning(
  stream: ReturnType<typeof createResponsesSseToV4Stream>,
): Promise<{ text: string; reasoning: Record<string, string> }> {
  const reader = stream.getReader();
  let text = "";
  const reasoning: Record<string, string> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || typeof value !== "object" || !("type" in value)) continue;

    if (value.type === "text-delta") {
      text += value.delta;
    }
    if (value.type === "reasoning-delta") {
      reasoning[value.id] = `${reasoning[value.id] ?? ""}${value.delta}`;
    }
  }

  return { text, reasoning };
}

function createImageGenerationStream(body: ReadableStream<Uint8Array>) {
  return createResponsesSseToV4Stream(body, {
    warnings: [],
    stripReactImageGenerationEnvelope: true,
  });
}

describe("createResponsesSseToV4Stream", () => {
  it("does not emit synthetic prelude reasoning (avoids UIMessage start/end mismatch)", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_1"}}',
      'data: {"type":"response.output_text.delta","delta":"Hi"}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_1"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

  it("emits reasoning summary deltas without synthetic status text", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_reasoning_delta"}}',
      'data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_delta"}}',
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_delta","delta":"I will inspect the request."}',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_delta"}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_reasoning_delta"}}',
      "data: [DONE]",
    ]);

    const { reasoning } = await collectStreamTextAndReasoning(
      createResponsesSseToV4Stream(body, { warnings: [] }),
    );

    expect(reasoning.rs_delta).toBe("I will inspect the request.");
  });

  it("emits reasoning from completed item summary when deltas are absent", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_reasoning_done"}}',
      'data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_done"}}',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_done","summary":[{"type":"summary_text","text":"I checked the structured summary."}]}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_reasoning_done"}}',
      "data: [DONE]",
    ]);

    const { reasoning } = await collectStreamTextAndReasoning(
      createResponsesSseToV4Stream(body, { warnings: [] }),
    );

    expect(reasoning.rs_done).toBe("I checked the structured summary.");
  });

  it("ignores non-summary text fields in completed reasoning items", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_reasoning_shape"}}',
      'data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_shape"}}',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_shape","summary":[{"type":"metadata","text":"contain"},{"type":"summary_text","text":"I created the final answer."}]}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_reasoning_shape"}}',
      "data: [DONE]",
    ]);

    const { reasoning } = await collectStreamTextAndReasoning(
      createResponsesSseToV4Stream(body, { warnings: [] }),
    );

    expect(reasoning.rs_shape).toBe("I created the final answer.");
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

    const stream = createResponsesSseToV4Stream(body, {
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

    const stream = createResponsesSseToV4Stream(body, {
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

    const stream = createResponsesSseToV4Stream(body, {
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

  it("emits image generation tool results as transient markdown image text", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_image"}}',
      'data: {"type":"response.output_text.delta","delta":"Here is the image:"}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call_output","output":{"status":"ok","imageUrl":"https://example.com/generated.png"}}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_image"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

  it("passes ReAct-shaped JSON through unless image envelope stripping is enabled", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A fox"}',
      thought: "Return this JSON literally.",
    };
    const text = JSON.stringify(envelope);
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_literal"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: text,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_literal"}}',
      "data: [DONE]",
    ]);

    const result = await collectStreamTextAndReasoning(
      createResponsesSseToV4Stream(body, { warnings: [] }),
    );

    expect(result.text).toBe(text);
    expect(result.reasoning["react-thought"]).toBeUndefined();
  });

  it("does not suppress mid-response ReAct JSON after non-envelope text (matches persist)", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A fox"}',
      thought: "Mid-body envelope.",
    };
    const envelopeJson = JSON.stringify(envelope);
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_mid"}}',
      'data: {"type":"response.output_text.delta","delta":"Intro\\n"}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: envelopeJson,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_mid"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe(`Intro\n${envelopeJson}`);
    expect(reasoning["react-thought"]).toBeUndefined();
  });

  it("suppresses ReAct JSON and emits thought as reasoning", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A fox"}',
      thought: "I should generate the image now.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_json"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: JSON.stringify(envelope),
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_json"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("");
    expect(reasoning["react-thought"]).toBe("I should generate the image now.");
  });

  it("suppresses Gemini dalle.text2im ReAct JSON and emits thought as reasoning", async () => {
    const envelope = {
      action: "dalle.text2im",
      action_input: '{"prompt":"A fox","aspect_ratio":"16:9"}',
      thought: "I should generate the image now.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_dalle_text2im_json"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: JSON.stringify(envelope, null, 2),
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_dalle_text2im_json"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("");
    expect(text).not.toContain("dalle.text2im");
    expect(reasoning["react-thought"]).toBe("I should generate the image now.");
  });

  it("suppresses a ReAct envelope and keeps trailing assistant text visible", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A cat"}',
      thought: "I will call the image tool.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_tail"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: `${JSON.stringify(envelope)}\n\nHere is the result.`,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_tail"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("\n\nHere is the result.");
    expect(text).not.toContain("openrouter_image_generation");
    expect(reasoning["react-thought"]).toBe("I will call the image tool.");
  });

  it("suppresses fenced ReAct JSON and keeps trailing assistant text visible", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A dog"}',
      thought: "I will generate this image.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_fenced"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`\n\nDone.`,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_fenced"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("\n\nDone.");
    expect(text).not.toContain("openrouter_image_generation");
    expect(reasoning["react-thought"]).toBe("I will generate this image.");
  });

  it("suppresses single-line fenced ReAct JSON with a space after json (no newline)", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A bird"}',
      thought: "Single-line fence.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_fenced_oneline"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: `\`\`\`json ${JSON.stringify(envelope)}\`\`\`\n\nAll set.`,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_fenced_oneline"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("\n\nAll set.");
    expect(text).not.toContain("openrouter_image_generation");
    expect(reasoning["react-thought"]).toBe("Single-line fence.");
  });

  it("suppresses single-line fenced ReAct JSON when space-after-json arrives before the JSON body", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A bird"}',
      thought: "Streaming single-line fence.",
    };
    const json = JSON.stringify(envelope);
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_fenced_oneline_split"}}',
      'data: {"type":"response.output_text.delta","delta":"```json "}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: `${json}\`\`\`\n\nTail.`,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_fenced_oneline_split"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("\n\nTail.");
    expect(text).not.toContain("openrouter_image_generation");
    expect(reasoning["react-thought"]).toBe("Streaming single-line fence.");
  });

  it("suppresses fenced ReAct JSON split across prefix deltas", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A dog"}',
      thought: "I will generate this image.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_fenced_split"}}',
      'data: {"type":"response.output_text.delta","delta":"```"}',
      'data: {"type":"response.output_text.delta","delta":"j"}',
      'data: {"type":"response.output_text.delta","delta":"son\\n"}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: `${JSON.stringify(envelope)}\n\`\`\`\n\nDone.`,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_fenced_split"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe("\n\nDone.");
    expect(text).not.toContain("openrouter_image_generation");
    expect(reasoning["react-thought"]).toBe("I will generate this image.");
  });

  it("passes plain JSON text through when it is not a ReAct envelope", async () => {
    const plainJson = '{"answer":42,"label":"not a tool call"}';
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_plain_json"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: plainJson,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_plain_json"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe(plainJson);
    expect(reasoning["react-thought"]).toBeUndefined();
  });

  it("passes action-shaped JSON through when it is not the image tool envelope", async () => {
    const plainJson = '{"action":"email","subject":"not a tool call"}';
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_action_json"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: plainJson,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_action_json"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toBe(plainJson);
    expect(reasoning["react-thought"]).toBeUndefined();
  });

  it("flushes oversized ambiguous ReAct candidates while preserving reasoning", async () => {
    const ambiguousText = `{${"x".repeat(17_000)}`;
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_ambiguous_react"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: ambiguousText,
      })}`,
      'data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_ambiguous"}}',
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_ambiguous","delta":"I can keep reasoning while text is ambiguous."}',
      'data: {"type":"response.output_text.delta","delta":" still visible"}',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_ambiguous"}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_ambiguous_react"}}',
      "data: [DONE]",
    ]);

    const stream = createImageGenerationStream(body);
    const reader = stream.getReader();
    const textDeltas: string[] = [];
    const reasoning: Record<string, string> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || typeof value !== "object" || !("type" in value)) continue;
      if (value.type === "text-delta") {
        textDeltas.push(value.delta);
      }
      if (value.type === "reasoning-delta") {
        reasoning[value.id] = `${reasoning[value.id] ?? ""}${value.delta}`;
      }
    }

    expect(textDeltas).toEqual([ambiguousText, " still visible"]);
    expect(reasoning.rs_ambiguous).toBe(
      "I can keep reasoning while text is ambiguous.",
    );
  });

  it("suppresses ReAct JSON while preserving function_call_output image previews", async () => {
    const envelope = {
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A robot"}',
      thought: "I will generate an image.",
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_react_image"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: JSON.stringify(envelope),
      })}`,
      'data: {"type":"response.output_item.done","item":{"type":"function_call_output","output":{"status":"ok","imageUrl":"https://example.com/generated-react.png"}}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_react_image"}}',
      "data: [DONE]",
    ]);

    const { text, reasoning } = await collectStreamTextAndReasoning(
      createImageGenerationStream(body),
    );

    expect(text).toContain(
      "![Generated image](https://example.com/generated-react.png)",
    );
    expect(text).not.toContain("openrouter_image_generation");
    expect(reasoning["react-thought"]).toBe("I will generate an image.");
  });

  it("emits data image tool results for live preview", async () => {
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_data_image"}}',
      `data: {"type":"response.output_item.done","item":{"type":"function_call_output","output":{"status":"ok","imageUrl":"${dataUrl}"}}}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_data_image"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    expect(text).toContain(`![Generated image](${dataUrl})`);
  });

  it("does not emit non-previewable image URL strings", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_invalid_image"}}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call_output","output":{"status":"ok","imageUrl":"not-a-url"}}}',
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_invalid_image"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    expect(text).not.toContain("![Generated image]");
    expect(text).not.toContain("not-a-url");
  });

  it("does not inject image markdown when assistant streams JSON text containing imageUrl", async () => {
    const jsonLine =
      '{"imageUrl":"https://example.com/structured-reply.json","answer":42}';
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_json_assistant"}}',
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: jsonLine,
      })}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_json_assistant"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    expect(text).toContain(jsonLine);
    expect(text).not.toContain("![Generated image]");
  });

  it("does not inject image markdown for message output_item.done with JSON in output_text", async () => {
    const jsonLine =
      '{"imageUrl":"https://example.com/not-a-generated-preview.png"}';
    const item = {
      type: "message",
      id: "msg_json",
      role: "assistant",
      content: [{ type: "output_text", text: jsonLine }],
    };
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_msg_item"}}',
      `data: {"type":"response.output_item.done","item":${JSON.stringify(item)}}`,
      "event: response.completed",
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_msg_item"}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    expect(text).not.toContain("![Generated image]");
    expect(text).not.toContain("not-a-generated-preview.png");
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

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

  it("emits the same image URL again for distinct output items", async () => {
    const body = encodeSse([
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_reused_image"}}',
      'data: {"type":"response.output_item.done","item":{"id":"item_1","type":"function_call_output","output":{"imageUrl":"https://example.com/reused.png"}}}',
      'data: {"type":"response.output_item.done","item":{"id":"item_2","type":"function_call_output","output":{"imageUrl":"https://example.com/reused.png"}}}',
      'data: {"type":"response.completed","status":"completed","response":{"id":"resp_reused_image","output":[{"imageUrl":"https://example.com/reused.png"}]}}',
      "data: [DONE]",
    ]);

    const stream = createResponsesSseToV4Stream(body, { warnings: [] });
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

    expect(
      text.match(/!\[Generated image\]\(https:\/\/example\.com\/reused\.png\)/g)
        ?.length,
    ).toBe(2);
  });
});
