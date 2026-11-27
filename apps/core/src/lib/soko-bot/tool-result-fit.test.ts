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

  describe("a cut page", () => {
    type Fitted = {
      result: {
        posts: { id: string }[];
        pagination: { nextCursor: string | null; total: number };
      };
      omitted: Record<string, number>;
      note: string;
    };
    const page = (nextCursor: string | null) => ({
      posts: Array.from({ length: 20 }, (_, i) => post(i)),
      pagination: { cursor: null, limit: 20, total: 24, nextCursor },
    });

    it("continues after the last item shown, so paging skips nothing", () => {
      const result = page("post-19");
      const fitted = fitToolResult("list_social_posts", result) as Fitted;
      const shown = fitted.result.posts.length;
      expect(shown).toBeLessThan(20);
      expect(fitted.result.pagination.nextCursor).toBe(`post-${shown - 1}`);
      expect(fitted.note).toContain(
        `shows ${shown} of its 20 posts. 24 in all.`,
      );
      expect(fitted.note).toContain("continues right after the last one shown");
      expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(
        TOOL_RESULT_MAX_CHARS,
      );
      expect(result.pagination.nextCursor).toBe("post-19");
    });

    it("drops an encoded cursor that would skip the items left out", () => {
      const fitted = fitToolResult(
        "list_social_posts",
        page("opaque-cursor"),
      ) as Fitted;
      const shown = fitted.result.posts.length;
      expect(fitted.result.pagination.nextCursor).toBeNull();
      expect(fitted.note).toContain(
        `Ask again with limit ${shown} to page on without skipping any.`,
      );
    });

    it("says how to see the rest of a last page", () => {
      const fitted = fitToolResult("list_social_posts", page(null)) as Fitted;
      const shown = fitted.result.posts.length;
      expect(fitted.result.pagination.nextCursor).toBeNull();
      expect(fitted.note).toContain(`Ask again with limit ${shown}`);
    });

    it("drops a top-level cursor too, as list_files returns it", () => {
      // Codex on #8449: 20 files cut to 15 kept the cursor after file 20.
      const result = {
        hasMore: true,
        nextCursor: "catalog-window-cursor",
        files: Array.from({ length: 20 }, (_, i) => post(i)),
      };
      const fitted = fitToolResult("list_files", result) as {
        result: { files: unknown[]; nextCursor: string | null };
        note: string;
      };
      const shown = fitted.result.files.length;
      expect(shown).toBeLessThan(20);
      expect(fitted.result.nextCursor).toBeNull();
      expect(fitted.note).toContain(`shows ${shown} of its 20 files.`);
      expect(fitted.note).toContain(`Ask again with limit ${shown}`);
      expect(result.nextCursor).toBe("catalog-window-cursor");
    });

    it("moves a top-level id cursor to the last item shown", () => {
      const result = {
        nextCursor: "post-19",
        posts: Array.from({ length: 20 }, (_, i) => post(i)),
      };
      const fitted = fitToolResult("list_social_posts", result) as {
        result: { posts: unknown[]; nextCursor: string };
        note: string;
      };
      const shown = fitted.result.posts.length;
      expect(fitted.result.nextCursor).toBe(`post-${shown - 1}`);
      expect(fitted.note).toContain("nextCursor continues right after");
    });
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

  it.each([
    "refresh_context",
    "read_memory",
    "read_strategy",
    "read_brand_brain",
    "read_calendar",
  ])("leaves %s whole: it bounds itself", (capability) => {
    const result = { markdown: '"q" \\ '.repeat(4_000) };
    expect(fitToolResult(capability, result)).toBe(result);
  });

  it("leaves a skill read whole: the model follows all of it", () => {
    const skill = { content: `${"rule ".repeat(10_000)}LAST RULE` };
    expect(fitToolResult("read_skill", skill)).toBe(skill);
    expect(fitToolResult("read_writing_skill", skill)).toBe(skill);
  });

  it.each([
    ["bash", { exitCode: 0, stdout: '"row",\\n'.repeat(30_000), stderr: "" }],
    ["workspace_read", { path: "data.csv", content: "a,b\n".repeat(50_000) }],
  ])("fits a sandbox-local %s result for the model", (capability, result) => {
    const fitted = fitToolResult(capability, result) as { note: string };
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(
      TOOL_RESULT_MAX_CHARS,
    );
    expect(fitted.note).toContain("more narrowly");
  });

  it("stays within the cap when the list of what it left out would not fit", () => {
    // Thousands of small lists, each cut: the omitted map alone outgrows the cap.
    const result = Object.fromEntries(
      Array.from({ length: 3_000 }, (_, index) => [
        `list_${index}_${"k".repeat(20)}`,
        ["x".repeat(40), "y".repeat(40)],
      ]),
    );
    const fitted = fitToolResult("run_integration_tool", result) as {
      omitted?: Record<string, number>;
    };
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(
      TOOL_RESULT_MAX_CHARS,
    );
    // At most one entry per trimming round.
    expect(Object.keys(fitted.omitted ?? {}).length).toBeLessThanOrEqual(40);
  });
});
