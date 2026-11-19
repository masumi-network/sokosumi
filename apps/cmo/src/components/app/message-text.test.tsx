import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageText, messageBlocks } from "./message-text";

const TABLE = [
  "Here are the three:",
  "",
  "| Name | Website | One strength |",
  "|---|---|---|",
  "| Crossmint | https://www.crossmint.com/ | **APIs** and no-code tools |",
  "| Venly | https://www.venly.io/ |",
  "",
  "These are from your Brand Brain.",
].join("\n");

const plain = (text: string) => [text];

describe("messageBlocks", () => {
  it("splits a message into its words and its table", () => {
    expect(messageBlocks(TABLE)).toEqual([
      { kind: "text", text: "Here are the three:" },
      {
        kind: "table",
        head: ["Name", "Website", "One strength"],
        rows: [
          [
            "Crossmint",
            "https://www.crossmint.com/",
            "**APIs** and no-code tools",
          ],
          ["Venly", "https://www.venly.io/"],
        ],
      },
      { kind: "text", text: "These are from your Brand Brain." },
    ]);
  });

  it("leaves pipes that are not a table as written", () => {
    const text = "Use a | b here.\n| not a table |\nDone.";
    expect(messageBlocks(text)).toEqual([{ kind: "text", text }]);
  });
});

describe("MessageText", () => {
  it("shows a table Cuso wrote as a table, not as pipes and dashes", () => {
    const html = renderToStaticMarkup(
      <MessageText content={TABLE} inline={plain} />,
    );
    expect(html).toContain('<th scope="col">Website</th>');
    expect(html).toContain("<td>Crossmint</td>");
    expect(html).not.toContain("|---|");
    expect(html).not.toContain("| Name |");
    // A short row still fills its columns.
    expect(html).toContain("<td>https://www.venly.io/</td><td></td>");
    expect(html).toContain('<p class="txt">Here are the three:</p>');
  });

  it("keeps a message without a table as one paragraph", () => {
    expect(
      renderToStaticMarkup(
        <MessageText content={"One.\n\nTwo."} inline={plain} />,
      ),
    ).toBe('<p class="txt">One.\n\nTwo.</p>');
  });
});
