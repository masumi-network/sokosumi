import { marked } from "marked";
import { describe, expect, it } from "vitest";

import { markdownToSafeHtml } from "@/lib/utils/sanitizeMarkdown";

import { latestResult, projectResultsMarkdown } from "./project-results-model";

describe("latestResult", () => {
  it("is the newest done comment, not a later plain comment", () => {
    expect(
      latestResult([
        {
          status: "COMPLETED",
          comment: "First draft",
          createdAt: "2026-11-01T09:00:00.000Z",
        },
        {
          status: "COMPLETED",
          comment: "Final draft",
          createdAt: "2026-11-03T09:00:00.000Z",
        },
        {
          status: null,
          comment: "Thanks!",
          createdAt: "2026-11-04T09:00:00.000Z",
        },
      ]),
    ).toEqual({
      comment: "Final draft",
      createdAt: "2026-11-03T09:00:00.000Z",
      by: null,
    });
  });

  it("names whoever wrote the result: a Coworker, a person or a Soko Bot", () => {
    const done = {
      status: "COMPLETED",
      comment: "Done.",
      createdAt: "2026-11-03T09:00:00.000Z",
    };
    expect(
      latestResult([
        { ...done, actor: { type: "coworker", coworker: { name: "Elena" } } },
      ])?.by,
    ).toBe("Elena");
    expect(
      latestResult([
        { ...done, actor: { type: "user", user: { name: "Ada Tester" } } },
      ])?.by,
    ).toBe("Ada Tester");
    expect(
      latestResult([
        { ...done, actor: { type: "sokoBot", sokoBot: { name: null } } },
      ])?.by,
    ).toBeNull();
  });

  it("is null when no done event carries a comment", () => {
    expect(
      latestResult([
        {
          status: "COMPLETED",
          comment: null,
          createdAt: "2026-11-01T09:00:00.000Z",
        },
        {
          status: "RUNNING",
          comment: "Working on it",
          createdAt: "2026-11-02T09:00:00.000Z",
        },
      ]),
    ).toBeNull();
  });
});

describe("projectResultsMarkdown", () => {
  it("puts each result under its own heading, below the Project title", () => {
    expect(
      projectResultsMarkdown({
        title: "Launch results",
        sections: [
          {
            heading: "SPR-1 Write the press release",
            meta: "Finished 3 Nov 2026",
            link: {
              label: "Open in Sokosumi",
              url: "https://app.example/tasks/a",
            },
            body: "The release text.",
          },
          {
            heading: "SPR-2 Pick a date",
            meta: "Finished 4 Nov 2026",
            link: {
              label: "Open in Sokosumi",
              url: "https://app.example/tasks/b",
            },
            body: "Tuesday.",
          },
        ],
      }),
    ).toBe(
      [
        "# Launch results",
        "",
        "## SPR\\-1 Write the press release",
        "",
        "Finished 3 Nov 2026 · [Open in Sokosumi](https://app.example/tasks/a)",
        "",
        "The release text.",
        "",
        "## SPR\\-2 Pick a date",
        "",
        "Finished 4 Nov 2026 · [Open in Sokosumi](https://app.example/tasks/b)",
        "",
        "Tuesday.",
        "",
      ].join("\n"),
    );
  });

  it("moves a result's own headings below its Task heading, but not inside code", () => {
    const markdown = projectResultsMarkdown({
      title: "T",
      sections: [
        {
          heading: "Task",
          meta: "m",
          link: { label: "Open", url: "https://x/t" },
          body: "# Summary\n\n```sh\n# a shell comment\n```\n\n## Details",
        },
      ],
    });
    expect(markdown).toContain("\n### Summary\n");
    expect(markdown).toContain("\n# a shell comment\n");
    expect(markdown).toContain("\n#### Details\n");
  });

  it("closes a result's unfinished code block before the next Task starts", () => {
    const section = (heading: string, body: string) => ({
      heading,
      meta: "m",
      link: { label: "Open", url: "https://x/t" },
      body,
    });
    const tokens = marked.lexer(
      projectResultsMarkdown({
        title: "T",
        sections: [
          section("First", "```js\nconst a = 1;"),
          section("Second", "Plain text."),
        ],
      }),
    );
    expect(
      tokens.flatMap((token) => (token.type === "heading" ? [token.text] : [])),
    ).toEqual(["T", "First", "Second"]);
  });

  it.each([
    ["a closer with words after it", "```text\nconst a = 1;\n```not-a-closer"],
    ["a closer indented four spaces", "```\ncode\n    ```"],
    ["a shorter closer", "````\ncode\n```"],
    ["a closer of the other fence character", "~~~\ncode\n```"],
  ])("keeps the next Task a heading in the PDF after %s", async (_, body) => {
    const section = (heading: string, text: string) => ({
      heading,
      meta: "m",
      link: { label: "Open", url: "https://x/t" },
      body: text,
    });
    const html = await markdownToSafeHtml(
      projectResultsMarkdown({
        title: "T",
        sections: [section("First", body), section("Second", "Plain text.")],
      }),
    );
    expect(html).toMatch(/<h2[^>]*>Second<\/h2>/);
    expect(html).toMatch(/<p>Plain text\.<\/p>/);
  });

  it("leaves a properly closed block and the text after it alone", async () => {
    const markdown = projectResultsMarkdown({
      title: "T",
      sections: [
        {
          heading: "First",
          meta: "m",
          link: { label: "Open", url: "https://x/t" },
          body: "   ```js\n# not a heading\n   ```   \n# Summary",
        },
      ],
    });
    expect(markdown).toContain("\n# not a heading\n");
    expect(markdown).toContain("\n### Summary\n");
    expect(markdown.match(/```/g)).toHaveLength(2);
  });

  it("keeps a heading's text from opening Markdown of its own", () => {
    const markdown = projectResultsMarkdown({
      title: "[Launch](https://evil.example)",
      sections: [],
    });
    expect(markdown).toBe("# \\[Launch\\]\\(https://evil\\.example\\)\n");
  });
});
