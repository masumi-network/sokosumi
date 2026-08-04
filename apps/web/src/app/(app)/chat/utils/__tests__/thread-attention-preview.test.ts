import { describe, expect, it } from "vitest";
import { formatThreadAttentionPreview } from "@/app/chat/utils/thread-attention-preview";

describe("formatThreadAttentionPreview", () => {
  it("strips markdown tokens and collapses whitespace", () => {
    expect(
      formatThreadAttentionPreview(
        "Hello **bold** and `b49207ef…`\n\nsecond line",
      ),
    ).toBe("Hello bold and b49207ef… second line");
  });

  it("collapses @id:slug mention tokens to @slug", () => {
    expect(
      formatThreadAttentionPreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:noodles Hello Noodles",
      ),
    ).toBe("@noodles Hello Noodles");
  });

  it("renders @all:all as @all", () => {
    expect(formatThreadAttentionPreview("ping @all:all please")).toBe(
      "ping @all please",
    );
  });

  it("returns empty string when content is only markup", () => {
    expect(formatThreadAttentionPreview("****")).toBe("");
  });
});
