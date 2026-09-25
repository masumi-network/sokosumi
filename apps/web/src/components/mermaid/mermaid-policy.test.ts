import { describe, expect, it } from "vitest";

import { REGRESSION } from "./__tests__/regression";
import { mermaidSourceError } from "./mermaid-policy";

describe("untrusted Mermaid policy", () => {
  it("accepts the exact regression with arrows, labels, cycle and database", () => {
    expect(mermaidSourceError(REGRESSION)).toBeNull();
  });
  it.each([
    '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B',
    "---\nconfig:\n securityLevel: loose\n---\nflowchart LR\nA-->B",
    'flowchart LR\nA["<img src=x onerror=alert(1)>"]',
    'flowchart LR\nclick A "javascript:alert(1)"',
    'flowchart LR\nA@{img: "https://example.com/leak"}',
    "flowchart LR\nstyle A fill:url(//example.com/leak)",
    "flowchart LR\nclassDef default fill:red",
    'flowchart LR\nA["&#60;script&#62;"]',
    'flowchart LR\nA["#60;img src=x#62;"]',
    'flowchart LR\nA["`![x](https://example.com)`"]',
    "sequenceDiagram\nA->>B: hi",
  ])("rejects active/unsupported source before DOM work: %s", (source) => {
    expect(mermaidSourceError(source)).toBe("unsupported");
  });
  it("bounds bytes, tokens, lines and edges", () => {
    expect(mermaidSourceError(`flowchart LR\nA[${"x".repeat(4000)}]`)).toBe(
      "tooLarge",
    );
    expect(mermaidSourceError(`flowchart LR\n${"A ".repeat(501)}`)).toBe(
      "tooLarge",
    );
    expect(mermaidSourceError(`flowchart LR\n${"A\n".repeat(101)}`)).toBe(
      "tooLarge",
    );
    expect(mermaidSourceError(`flowchart LR\n${"A-->B;".repeat(51)}`)).toBe(
      "tooLarge",
    );
  });
});
