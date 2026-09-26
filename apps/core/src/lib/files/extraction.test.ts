import { FileExtractionState } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  chunkExtractedText,
  classifyExtraction,
  extractDocument,
  FILE_CHUNK_MAX_PER_VERSION,
  normalizeExtractedText,
} from "./extraction";

const encoder = new TextEncoder();

describe("classifyExtraction", () => {
  it("reads plain text, markdown and csv", () => {
    expect(
      classifyExtraction({ mimeType: "text/plain", displayName: "notes.txt" }),
    ).toBe("text");
    expect(
      classifyExtraction({ mimeType: null, displayName: "readme.md" }),
    ).toBe("text");
    expect(
      classifyExtraction({ mimeType: "text/csv", displayName: "rows.csv" }),
    ).toBe("text");
  });

  it("marks PDF and OOXML unsupported rather than pretending to read them", () => {
    expect(
      classifyExtraction({
        mimeType: "application/pdf",
        displayName: "brief.pdf",
      }),
    ).toBe("unsupported-binary-document");
    expect(
      classifyExtraction({ mimeType: null, displayName: "deck.pptx" }),
    ).toBe("unsupported-binary-document");
  });

  it("marks media as name-only", () => {
    expect(
      classifyExtraction({ mimeType: "image/png", displayName: "shot.png" }),
    ).toBe("unsupported-media");
  });
});

describe("normalizeExtractedText", () => {
  it("strips a BOM, unifies newlines and removes control characters", () => {
    const normalized = normalizeExtractedText("﻿a\r\nbc");
    expect(normalized).toBe("a\nb c");
  });

  it("collapses long runs of blank lines", () => {
    expect(normalizeExtractedText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("chunkExtractedText", () => {
  it("prefers a paragraph boundary over a hard cut", () => {
    const first = "x".repeat(1_900);
    const second = "y".repeat(500);
    const chunks = chunkExtractedText(`${first}\n\n${second}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.endsWith("x")).toBe(true);
  });

  it("records anchors that point back into the source", () => {
    const chunks = chunkExtractedText("alpha\n\nbeta");
    expect(chunks[0].anchor.start).toBe(0);
    expect(chunks[0].anchor.kind).toBe("char");
  });

  it("stops at the per-version chunk cap", () => {
    const chunks = chunkExtractedText("word ".repeat(400_000));
    expect(chunks.length).toBeLessThanOrEqual(FILE_CHUNK_MAX_PER_VERSION);
  });

  it("gives each chunk a distinct digest so a score cannot be reused", () => {
    const chunks = chunkExtractedText("alpha\n\nbeta\n\ngamma");
    const digests = new Set(chunks.map((chunk) => chunk.inputDigest));
    expect(digests.size).toBe(chunks.length);
  });
});

describe("extractDocument", () => {
  it("indexes a short text file completely", () => {
    const result = extractDocument({
      bytes: encoder.encode("Aurora research findings about commuters."),
      mimeType: "text/plain",
      displayName: "aurora.txt",
    });
    expect(result.state).toBe(FileExtractionState.INDEXED);
    expect(result.coverage).toBe(1);
    expect(result.chunks).toHaveLength(1);
    expect(result.reason).toBeNull();
  });

  it("reports an unsupported format with a reason and no chunks", () => {
    const result = extractDocument({
      bytes: encoder.encode("%PDF-1.7"),
      mimeType: "application/pdf",
      displayName: "brief.pdf",
    });
    expect(result.state).toBe(FileExtractionState.UNSUPPORTED);
    expect(result.chunks).toHaveLength(0);
    expect(result.reason).toContain("sandboxed parser");
  });

  it("reports partial rather than silently claiming full coverage", () => {
    const result = extractDocument({
      bytes: encoder.encode("word ".repeat(400_000)),
      mimeType: "text/plain",
      displayName: "huge.txt",
    });
    expect(result.state).toBe(FileExtractionState.PARTIAL);
    expect(result.coverage).toBeLessThan(1);
    expect(result.reason).toContain("beginning");
  });

  it("does not claim text for an empty file", () => {
    const result = extractDocument({
      bytes: encoder.encode("   \n  "),
      mimeType: "text/plain",
      displayName: "blank.txt",
    });
    expect(result.state).toBe(FileExtractionState.PARTIAL);
    expect(result.chunks).toHaveLength(0);
  });
});
