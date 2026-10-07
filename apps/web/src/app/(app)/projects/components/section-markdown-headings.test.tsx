import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SECTION_MARKDOWN_HEADINGS } from "@/app/projects/components/section-markdown-headings";
import Markdown from "@/components/markdown";

describe("SECTION_MARKDOWN_HEADINGS", () => {
  it("nests a document's headings under the section's h2", () => {
    render(
      <Markdown components={SECTION_MARKDOWN_HEADINGS}>
        {
          "# Title\n\n## Goals\n\n### Detail\n\n#### Note\n\n##### Aside\n\n###### Footnote"
        }
      </Markdown>,
    );

    expect(screen.getByRole("heading", { name: "Title" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Goals" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Detail" }).tagName).toBe("H4");
    expect(screen.getByRole("heading", { name: "Note" }).tagName).toBe("H5");
    expect(screen.getByRole("heading", { name: "Aside" }).tagName).toBe("H6");
    expect(screen.getByRole("heading", { name: "Footnote" }).tagName).toBe(
      "H6",
    );
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});
