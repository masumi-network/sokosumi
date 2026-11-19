import { describe, expect, it } from "vitest";

import {
  removeSeoTaskRequest,
  seoTaskDescription,
  seoTaskRequestPacket,
} from "./seo-task-request.js";

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
