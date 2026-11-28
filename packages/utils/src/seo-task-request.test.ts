import { describe, expect, it } from "vitest";

import {
  hasSeoTaskRequest,
  hideSeoAuditRequest,
  removeSeoTaskRequest,
  seoTaskDescription,
  seoTaskRequestPacket,
  splitSeoTaskRequest,
} from "./seo-task-request.js";
import { removeTaskContextAttachmentLinks } from "./task-context-attachment.js";

const packet = { version: 1, pageUrls: ["https://example.com/"] };

describe("seoTaskRequestPacket", () => {
  it("reads the request line under a readable summary", () => {
    const description = seoTaskDescription(
      "Full SEO audit of 1 page.",
      "seo_audit",
      packet,
    );
    expect(seoTaskRequestPacket(description, "seo_audit")).toEqual(packet);
  });

  it("refuses a second request line, also of the other marker", () => {
    const one = seoTaskDescription("Summary", "seo_audit", packet);
    expect(() =>
      seoTaskRequestPacket(`${one}\nseo_audit: {}`, "seo_audit"),
    ).toThrow();
    expect(() =>
      seoTaskRequestPacket(`${one}\nseo_job: {}`, "seo_audit"),
    ).toThrow();
    expect(() =>
      seoTaskRequestPacket(`${one}\nseo_crawl_next: {}`, "seo_audit"),
    ).toThrow();
  });

  it("counts a marker in any case and after spaces, as the worker does", () => {
    const one = seoTaskDescription("Summary", "seo_audit", packet);
    expect(() =>
      seoTaskRequestPacket(`${one}\n  SEO_AUDIT : {}`, "seo_audit"),
    ).toThrow();
    expect(seoTaskRequestPacket(`  SEO_JOB : {"a":1}`, "seo_job")).toEqual({
      a: 1,
    });
  });

  it("refuses the wrong marker, a missing line and broken JSON", () => {
    const job = seoTaskDescription("Summary", "seo_job", packet);
    expect(() => seoTaskRequestPacket(job, "seo_audit")).toThrow();
    expect(() => seoTaskRequestPacket("Summary only", "seo_job")).toThrow();
    expect(() => seoTaskRequestPacket("seo_job: {", "seo_job")).toThrow();
  });
});

describe("removeSeoTaskRequest", () => {
  it("leaves a description without a request line exactly as written", () => {
    const code = "    line one\r\n    line two\n";
    expect(removeSeoTaskRequest(code)).toBe(code);
  });

  it("shows the summary without the machine line", () => {
    const description = seoTaskDescription(
      "Full SEO audit of 1 page.",
      "seo_audit",
      packet,
    );
    expect(removeSeoTaskRequest(description)).toBe("Full SEO audit of 1 page.");
  });

  it("leaves an old JSON-only description empty and other text alone", () => {
    expect(removeSeoTaskRequest(`seo_job: ${JSON.stringify(packet)}`)).toBe("");
    expect(removeSeoTaskRequest("Fix the seo_audit: page title")).toBe(
      "Fix the seo_audit: page title",
    );
    expect(removeSeoTaskRequest("SEO_job: rewrite the titles")).toBe(
      "SEO_job: rewrite the titles",
    );
  });
});

describe("hideSeoAuditRequest", () => {
  it("hides a full audit's price terms and keeps a focused check's line", () => {
    expect(
      hideSeoAuditRequest(
        'Full SEO audit of 2 selected pages:\n\nseo_audit: {"version":1}',
      ),
    ).toBe("Full SEO audit of 2 selected pages:");
    const focused = 'Check titles\n\nseo_job: {"version":1}';
    expect(hideSeoAuditRequest(focused)).toBe(focused);
    expect(hideSeoAuditRequest('seo_audit: {"version":1}')).toBeNull();
  });

  it("hides a crawl continuation's price terms", () => {
    expect(
      hideSeoAuditRequest(
        'Crawl the next 500 pages\n\n SEO_CRAWL_NEXT : {"price":{"markupPercent":50}}',
      ),
    ).toBe("Crawl the next 500 pages");
  });
});

describe("splitSeoTaskRequest", () => {
  const linkInPacket = { note: "see [BRIEFING.md](https://x)" };
  const edit = (markdown: string) => {
    const { prose, join } = splitSeoTaskRequest(markdown);
    return join(removeTaskContextAttachmentLinks(prose));
  };

  it("edits the prose and keeps the request line byte for byte", () => {
    const description = seoTaskDescription(
      "Summary [BRIEFING.md](https://x)",
      "seo_audit",
      linkInPacket,
    );
    expect(edit(description)).toBe(
      seoTaskDescription("Summary", "seo_audit", linkInPacket),
    );
  });

  it("keeps a crawl continuation's line byte for byte", () => {
    const description = seoTaskDescription(
      "Summary [BRIEFING.md](https://x)",
      "seo_crawl_next",
      linkInPacket,
    );
    expect(edit(description)).toBe(
      seoTaskDescription("Summary", "seo_crawl_next", linkInPacket),
    );
  });

  it("passes text without a request line to the edit whole", () => {
    expect(edit("a [BRIEFING.md](https://x) b")).toBe("a  b");
  });
});

describe("hasSeoTaskRequest", () => {
  it.each([
    [
      "a seo_job line",
      seoTaskDescription("Summary", "seo_job", packet),
      "seo_job",
      true,
    ],
    [
      "a seo_audit line, asked for seo_job",
      seoTaskDescription("Summary", "seo_audit", packet),
      "seo_job",
      false,
    ],
    [
      "prose that starts with the marker",
      "seo_job: fix titles",
      "seo_job",
      false,
    ],
    ["no text", null, "seo_job", false],
  ] as const)("%s", (_name, text, marker, expected) => {
    expect(hasSeoTaskRequest(text, marker)).toBe(expected);
  });
});
