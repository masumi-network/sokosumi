import { describe, expect, it } from "vitest";

import {
  buildResponsesApiWarnings,
  lastTurnToResponsesInput,
  promptToResponsesInput,
} from "./to-responses-input.js";

describe("promptToResponsesInput", () => {
  it("maps system, user, and assistant to input_text messages", () => {
    const input = promptToResponsesInput([
      { role: "system", content: "You are helpful." },
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi!" }],
      },
    ]);
    expect(input).toEqual([
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "You are helpful." }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "input_text", text: "Hi!" }],
      },
    ]);
  });

  it("skips empty user turns", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [{ type: "text", text: "   " }],
      },
    ]);
    expect(input).toEqual([]);
  });

  it("concatenates adjacent user text parts into one input_text", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: " " },
          { type: "text", text: "world" },
        ],
      },
    ]);
    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello world" }],
      },
    ]);
  });

  it("maps image urls and file data to multimodal responses content", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          { type: "text", text: "Please review these." },
          {
            type: "file",
            mediaType: "image/png",
            data: new URL("https://example.com/image.png"),
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "brief.pdf",
            data: "JVBERi0xLjcK",
          },
        ],
      },
    ]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Please review these." },
          {
            type: "input_image",
            image_url: "https://example.com/image.png",
            detail: "auto",
          },
          {
            type: "input_file",
            file_data: "data:application/pdf;base64,JVBERi0xLjcK",
            filename: "brief.pdf",
          },
        ],
      },
    ]);
  });

  it("accepts data URLs with empty mediatype before ;base64 (blob-style)", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "application/octet-stream",
            filename: "blob.bin",
            data: "data:;base64,SGVsbG8=",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "from-url.pdf",
            data: new URL("data:;base64,JVBERi0xLjcK"),
          },
        ],
      },
    ]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_file",
            file_data: "data:;base64,SGVsbG8=",
            filename: "blob.bin",
          },
          {
            type: "input_file",
            file_data: "data:;base64,JVBERi0xLjcK",
            filename: "from-url.pdf",
          },
        ],
      },
    ]);
  });

  it("maps non-image file parts with https blob URL string to input_file file_url", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "brief.pdf",
            data: "https://storage.example.com/containers/blobs/abc123.pdf",
          },
        ],
      },
    ]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_file",
            file_url: "https://storage.example.com/containers/blobs/abc123.pdf",
            filename: "brief.pdf",
          },
        ],
      },
    ]);
  });

  it("maps non-image file parts with https URL objects to input_file file_url", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "brief.pdf",
            data: new URL(
              "https://storage.example.com/containers/blobs/abc123.pdf",
            ),
          },
        ],
      },
    ]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_file",
            file_url: "https://storage.example.com/containers/blobs/abc123.pdf",
            filename: "brief.pdf",
          },
        ],
      },
    ]);
  });

  it("maps AI SDK v7 tagged url file parts to input_file file_url", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          { type: "text", text: "Please review." },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "brief.pdf",
            data: {
              type: "url",
              url: new URL(
                "https://storage.example.com/containers/blobs/abc123.pdf",
              ),
            },
          },
          {
            type: "file",
            mediaType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename: "notes.docx",
            data: {
              type: "url",
              url: new URL(
                "https://storage.example.com/containers/blobs/notes.docx",
              ),
            },
          },
        ],
      },
    ] as Parameters<typeof promptToResponsesInput>[0]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Please review." },
          {
            type: "input_file",
            file_url: "https://storage.example.com/containers/blobs/abc123.pdf",
            filename: "brief.pdf",
          },
          {
            type: "input_file",
            file_url: "https://storage.example.com/containers/blobs/notes.docx",
            filename: "notes.docx",
          },
        ],
      },
    ]);
  });

  it("maps AI SDK v7 tagged data and image url file parts", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "image/png",
            data: {
              type: "url",
              url: new URL("https://example.com/image.png"),
            },
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "brief.pdf",
            data: {
              type: "data",
              data: "JVBERi0xLjcK",
            },
          },
        ],
      },
    ] as Parameters<typeof promptToResponsesInput>[0]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: "https://example.com/image.png",
            detail: "auto",
          },
          {
            type: "input_file",
            file_data: "data:application/pdf;base64,JVBERi0xLjcK",
            filename: "brief.pdf",
          },
        ],
      },
    ]);
  });

  it("throws for AI SDK v7 provider file references", () => {
    expect(() =>
      promptToResponsesInput([
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              filename: "brief.pdf",
              data: {
                type: "reference",
                reference: { openai: "file-abc" },
              },
            },
          ],
        },
      ] as Parameters<typeof promptToResponsesInput>[0]),
    ).toThrowError(/provider file references/i);
  });

  it("throws for non-base64 file data urls that cannot be mapped safely", () => {
    expect(() =>
      promptToResponsesInput([
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              filename: "brief.pdf",
              data: "data:application/pdf,plain-text",
            },
          ],
        },
      ]),
    ).toThrowError(/base64/i);
  });

  it("throws for image file parts with non-http(s) URL strings", () => {
    expect(() =>
      promptToResponsesInput([
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: "file:///tmp/x.png",
            },
          ],
        },
      ]),
    ).toThrowError(/http\(s\)/i);
  });
});

describe("buildResponsesApiWarnings", () => {
  it("warns for assistant file parts and non-http(s) document URLs", () => {
    const warnings = buildResponsesApiWarnings([
      {
        role: "assistant",
        content: [
          { type: "text", text: "See attached." },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "x.pdf",
            data: new URL("file:///tmp/x.pdf"),
          },
        ],
      },
    ]);

    expect(warnings).toEqual([
      {
        type: "compatibility",
        feature: "assistant file parts",
        details:
          "File parts on assistant messages are forwarded to the Responses input. Confirm your model endpoint accepts multimodal assistant turns.",
      },
      {
        type: "compatibility",
        feature: "non-HTTP(S) file URL",
        details:
          'A file part uses URL "file:///tmp/x.pdf" as file_url. Only http(s) and data payloads are fully supported; other schemes may be rejected or mishandled by the upstream API.',
      },
    ]);
  });

  it("dedupes repeated assistant-file warnings for one message", () => {
    const warnings = buildResponsesApiWarnings([
      {
        role: "assistant",
        content: [
          {
            type: "file",
            mediaType: "application/pdf",
            data: "JVBERi0xLjcK",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            data: "JVBERi0xLjcK",
          },
        ],
      },
    ]);

    expect(
      warnings.filter(
        (w) =>
          w.type === "compatibility" && w.feature === "assistant file parts",
      ),
    ).toHaveLength(1);
  });
});

describe("lastTurnToResponsesInput", () => {
  it("keeps only the last user message when preceded by assistant", () => {
    const input = lastTurnToResponsesInput([
      {
        role: "user",
        content: [{ type: "text", text: "First" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Second" }],
      },
    ]);
    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Second" }],
      },
    ]);
  });

  it("includes trailing system when it is the last user/system message", () => {
    const input = lastTurnToResponsesInput([
      {
        role: "user",
        content: [{ type: "text", text: "Hi" }],
      },
      {
        role: "system",
        content: "Override",
      },
    ]);
    expect(input.some((m) => m.role === "system")).toBe(true);
  });

  it("keeps image-only user turns", () => {
    const input = lastTurnToResponsesInput([
      {
        role: "assistant",
        content: [{ type: "text", text: "Show me the image." }],
      },
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "image/png",
            data: new URL("https://example.com/image.png"),
          },
        ],
      },
    ]);

    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: "https://example.com/image.png",
            detail: "auto",
          },
        ],
      },
    ]);
  });
});
