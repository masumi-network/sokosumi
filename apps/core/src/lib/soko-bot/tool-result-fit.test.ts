import { describe, expect, it } from "vitest";
import { fitToolResult, TOOL_RESULT_MAX_CHARS } from "./tool-result-fit";

const post = (index: number) => ({
  id: `post-${index}`,
  text: "x".repeat(900),
});

describe("fitToolResult", () => {
  it("returns a result that fits unchanged", () => {
    const result = { posts: [post(1)] };
    expect(fitToolResult("list_social_posts", result)).toBe(result);
  });

  it("leaves items off the end of the longest list and says how many", () => {
    const result = { posts: Array.from({ length: 40 }, (_, i) => post(i)) };
    const fitted = fitToolResult("list_social_posts", result) as {
      result: { posts: { id: string }[] };
      omitted: Record<string, number>;
      note: string;
    };
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(
      TOOL_RESULT_MAX_CHARS,
    );
    expect(fitted.result.posts[0].id).toBe("post-0");
    expect(fitted.result.posts.length + fitted.omitted.posts).toBe(40);
    expect(fitted.note).toContain("smaller limit");
    expect(result.posts).toHaveLength(40);
  });

  it("cuts one long text to a preview with the same note", () => {
    const fitted = fitToolResult("read_file", {
      text: "y".repeat(60_000),
    }) as { preview: string; note: string };
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(
      TOOL_RESULT_MAX_CHARS,
    );
    expect(fitted.note).toContain("more narrowly");
  });

  it("leaves the context refresh whole: the packet has its own budget", () => {
    const result = { text: "z".repeat(40_000) };
    expect(fitToolResult("refresh_context", result)).toBe(result);
  });
});
