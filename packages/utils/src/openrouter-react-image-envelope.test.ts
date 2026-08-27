import { describe, expect, it } from "vitest";

import {
  extractReactEnvelope,
  normalizeReactEnvelopeTrailingText,
  parseReactEnvelopeBuffer,
} from "./openrouter-react-image-envelope.js";

describe("parseReactEnvelopeBuffer", () => {
  it("accepts single-line ```json {…} ``` without a newline after json", () => {
    const inner = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"x"}',
      thought: "t",
    });
    const buffer = `\`\`\`json ${inner}\`\`\`\n\nTail`;
    const r = parseReactEnvelopeBuffer(buffer);
    expect(r).toEqual({
      status: "complete",
      isReactEnvelope: true,
      thought: "t",
      trailing: "\n\nTail",
    });
  });

  it("accepts Gemini dalle.text2im ReAct envelopes", () => {
    const buffer = JSON.stringify({
      action: "dalle.text2im",
      action_input: '{"prompt":"A calm robot","aspect_ratio":"16:9"}',
      thought: "I should generate the image now.",
    });
    const r = parseReactEnvelopeBuffer(buffer);
    expect(r).toEqual({
      status: "complete",
      isReactEnvelope: true,
      thought: "I should generate the image now.",
      trailing: "",
    });
  });

  it("returns incomplete while a fenced envelope is missing the closing fence", () => {
    const inner = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"x"}',
      thought: "t",
    });
    expect(parseReactEnvelopeBuffer(`\`\`\`json\n${inner}`).status).toBe(
      "incomplete",
    );
  });

  it("returns full buffer when fenced inner JSON is not a ReAct envelope", () => {
    const inner = JSON.stringify({ action: "other", action_input: "{}" });
    const buffer = `\`\`\`json\n${inner}\n\`\`\`\n`;
    const r = parseReactEnvelopeBuffer(buffer);
    expect(r).toEqual({
      status: "complete",
      isReactEnvelope: false,
      thought: "",
      trailing: buffer,
    });
  });
});

describe("normalizeReactEnvelopeTrailingText", () => {
  it("strips horizontal whitespace before line feeds then collapses blank runs", () => {
    expect(normalizeReactEnvelopeTrailingText("  \n\n\n\nbody")).toBe("body");
  });

  it("handles long runs of tabs before newlines in linear time", () => {
    const tabs = "\t".repeat(50_000);
    expect(normalizeReactEnvelopeTrailingText(`${tabs}\nok`)).toBe("ok");
  });
});

describe("extractReactEnvelope", () => {
  it("matches parseReactEnvelopeBuffer for a complete envelope", () => {
    const inner = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"x"}',
      thought: "Reason",
    });
    const text = `\`\`\`json ${inner}\`\`\`\n\nDone`;
    expect(extractReactEnvelope(text)).toEqual({
      strippedText: "Done",
      thought: "Reason",
      hadEnvelope: true,
    });
  });

  it("returns original text when the buffer parse is incomplete", () => {
    const text = "```json\n{";
    expect(extractReactEnvelope(text)).toEqual({
      strippedText: text,
      thought: null,
      hadEnvelope: false,
    });
  });
});
