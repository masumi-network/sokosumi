import { describe, expect, it } from "vitest";
import {
  extractFileLikeLinks,
  extractLinks,
} from "../markdown-links-extract.js";

describe("extractLinks", () => {
  it("extracts markdown links", () => {
    const links = extractLinks("[text](https://example.com/file.pdf)");
    expect(links).toEqual([
      { url: "https://example.com/file.pdf", text: "text" },
    ]);
  });

  it("extracts autolinks", () => {
    const links = extractLinks("<https://example.com/file.pdf>");
    expect(links).toEqual([{ url: "https://example.com/file.pdf" }]);
  });

  it("extracts multiple links", () => {
    const links = extractLinks(
      "[pdf](https://example.com/file.pdf) and <https://example.com/doc.docx>",
    );
    expect(links).toEqual([
      { url: "https://example.com/file.pdf", text: "pdf" },
      { url: "https://example.com/doc.docx" },
    ]);
  });
});

describe("extractFileLikeLinks", () => {
  describe("markdown links", () => {
    it("extracts file-like URLs from markdown links", () => {
      const links = extractFileLikeLinks("[pdf](https://example.com/file.pdf)");
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });

    it("extracts file-like URLs from autolinks", () => {
      const links = extractFileLikeLinks("<https://example.com/file.pdf>");
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });
  });

  describe("bare URLs", () => {
    it("extracts bare file-like URLs with .pdf extension", () => {
      const links = extractFileLikeLinks(
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      );
      expect(links).toEqual([
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      ]);
    });

    it("extracts bare /deliverables/ URLs without extension", () => {
      const links = extractFileLikeLinks(
        "https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f",
      );
      expect(links).toEqual([
        "https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f",
      ]);
    });

    it("extracts bare URLs in prose with surrounding text", () => {
      const links = extractFileLikeLinks(
        "Check out this file: https://example.com/report.pdf for details.",
      );
      expect(links).toEqual(["https://example.com/report.pdf"]);
    });

    it("strips trailing punctuation from bare URLs", () => {
      const links = extractFileLikeLinks("See https://example.com/file.pdf.");
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });

    it("handles multiple bare file-like URLs", () => {
      const links = extractFileLikeLinks(
        "Files: https://example.com/a.pdf and https://example.com/b.docx",
      );
      expect(links).toEqual([
        "https://example.com/a.pdf",
        "https://example.com/b.docx",
      ]);
    });
  });

  describe("mixed formats", () => {
    it("extracts from all formats: markdown, autolink, and bare", () => {
      const links = extractFileLikeLinks(
        "[pdf](https://example.com/a.pdf) <https://example.com/b.docx> https://example.com/c.xlsx",
      );
      expect(links).toEqual([
        "https://example.com/a.pdf",
        "https://example.com/b.docx",
        "https://example.com/c.xlsx",
      ]);
    });

    it("deduplicates URLs across formats", () => {
      const links = extractFileLikeLinks(
        "[pdf](https://example.com/file.pdf) <https://example.com/file.pdf> https://example.com/file.pdf",
      );
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });
  });

  describe("QA regression fixtures", () => {
    it("extracts both QA fixture URLs as bare text", () => {
      const comment = `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f`;

      const links = extractFileLikeLinks(comment);
      expect(links).toContain(
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      );
      expect(links).toContain(
        "https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f",
      );
      expect(links).toHaveLength(2);
    });

    it("extracts both QA fixture URLs as markdown links", () => {
      const comment = `[dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)
[deliverable](https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f)`;

      const links = extractFileLikeLinks(comment);
      expect(links).toContain(
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      );
      expect(links).toContain(
        "https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f",
      );
      expect(links).toHaveLength(2);
    });

    it("extracts both QA fixture URLs as autolinks", () => {
      const comment = `<https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf>
<https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f>`;

      const links = extractFileLikeLinks(comment);
      expect(links).toContain(
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      );
      expect(links).toContain(
        "https://elena.serviceplan-agents.com/files/tasks/25735e16-0000-0000-0000-000000000001/deliverables/01a019d9-cda2-76f8-902a-d8ce5250ea6f",
      );
      expect(links).toHaveLength(2);
    });
  });

  describe("filters", () => {
    it("excludes non-file-like bare URLs", () => {
      const links = extractFileLikeLinks(
        "https://example.com/page and https://example.com/file.pdf",
      );
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });

    it("excludes URLs with hash fragments", () => {
      const links = extractFileLikeLinks("https://example.com/file.pdf#page=2");
      expect(links).toEqual([]);
    });

    it("excludes non-http(s) URLs", () => {
      const links = extractFileLikeLinks("ftp://example.com/file.pdf");
      expect(links).toEqual([]);
    });
  });

  describe("escaped markdown destinations", () => {
    it("does not double-count escaped paren in markdown destination as bare URL", () => {
      const links = extractFileLikeLinks(
        "[label](https://example.com/image\\).png)",
      );
      expect(links).toEqual(["https://example.com/image).png"]);
    });

    it("extracts only unescaped URL from markdown with escaped backslash", () => {
      const markdown = [
        "[doc](https://example.com/file.pdf)",
        "[image with escaped paren](https://example.com/image\\).png)",
      ].join("\n");

      const links = extractFileLikeLinks(markdown);
      expect(links).toContain("https://example.com/file.pdf");
      expect(links).toContain("https://example.com/image).png");
      expect(links).not.toContain("https://example.com/image\\).png");
      expect(links).toHaveLength(2);
    });
  });

  describe("ReDoS regression", () => {
    it("does not hang on unclosed autolink with many repeats", () => {
      // CodeQL polynomial regex alert: <http:// + many chars without closing >
      const attack = "<http://" + "a".repeat(10000);
      const links = extractFileLikeLinks(attack);
      expect(links).toEqual([]);
    });

    it("extracts valid autolinks even after unclosed ones", () => {
      const markdown = [
        "<http://" + "x".repeat(100),
        "<https://example.com/file.pdf>",
      ].join("\n");

      const links = extractFileLikeLinks(markdown);
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });

    it("handles repeated unclosed autolinks in linear time", () => {
      // Nested <http:// without closing > — must not be quadratic
      const attack = "<http://".repeat(1000);
      const links = extractFileLikeLinks(attack);
      expect(links).toEqual([]);
    });

    it("extracts valid autolink after nested unclosed ones", () => {
      const markdown = "<http://<http://<https://example.com/file.pdf>";
      const links = extractFileLikeLinks(markdown);
      expect(links).toEqual(["https://example.com/file.pdf"]);
    });
  });
});
