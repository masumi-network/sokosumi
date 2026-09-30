import { describe, expect, it } from "vitest";

import { markdownToExportHtml } from "@/components/jobs/job-details/download-button";

const BLOCKED = '<iframe srcdoc="x"></iframe><script>x</script>';

/** The export's own wrapper carries a `<style>`; read what is inside it. */
async function exportBody(markdown: string): Promise<string> {
  const html = await markdownToExportHtml(markdown);
  return html.slice(html.indexOf("</style>"));
}

describe("markdownToExportHtml", () => {
  // Each reads as a fence to the line rule and as raw HTML to the parser.
  it.each([
    [
      "an HTML block opened on the line above",
      `<p>\n\`\`\`\n${BLOCKED}\n\`\`\``,
    ],
    [
      "a closed element on the line above",
      `<p>x</p>\n\`\`\`\n${BLOCKED}\n\`\`\``,
    ],
    [
      "an element the parser ends at its own close tag",
      `<pre>\n\n\`\`\`\n</pre>${BLOCKED}\n\`\`\``,
    ],
  ])("prints no script or iframe for %s", async (_name, markdown) => {
    expect(await exportBody(markdown)).not.toMatch(
      /<(script|iframe|style|link|meta|base|form|object|embed)/i,
    );
  });

  it("drops event handlers and inline styles from allowed tags", async () => {
    const body = await exportBody(
      '<p>\n```\n<img src="https://e.test/a.png" onerror="x" style="x">\n```',
    );

    expect(body).toContain('src="https://e.test/a.png"');
    expect(body).not.toMatch(/onerror|style=/);
  });

  it("keeps markup written inside a real fence as text", async () => {
    const body = await exportBody(`\`\`\`html\n${BLOCKED}\n\`\`\``);

    expect(body).toContain('<pre><code class="language-html">&lt;iframe');
    expect(body).not.toMatch(/<(script|iframe)/i);
  });

  it("keeps what markdown itself generates", async () => {
    const body = await exportBody(
      [
        "#### Heading",
        "",
        "> quote",
        "",
        "3. three",
        "",
        "- [x] done",
        "",
        "| a | b |",
        "| :-: | - |",
        "| 1 | 2 |",
        "",
        '~~gone~~ **bold** `code` [link](https://e.test "Title")',
        "",
        '![alt](https://e.test/a.png "Img")',
        "",
        "---",
      ].join("\n"),
    );

    expect(body).toContain("<h4>Heading</h4>");
    expect(body).toContain("<blockquote>");
    expect(body).toContain('<ol start="3">');
    expect(body).toMatch(/<input[^>]*type="checkbox"/);
    expect(body).toMatch(/<input[^>]*checked/);
    expect(body).toContain('<th align="center">a</th>');
    expect(body).toContain("<td>2</td>");
    expect(body).toContain("<del>gone</del>");
    expect(body).toContain("<strong>bold</strong>");
    expect(body).toContain("<code>code</code>");
    expect(body).toContain('<a href="https://e.test" title="Title">link</a>');
    expect(body).toMatch(
      /<img src="https:\/\/e\.test\/a\.png" alt="alt" title="Img" ?\/?>/,
    );
    expect(body).toMatch(/<hr ?\/?>/);
  });
});
