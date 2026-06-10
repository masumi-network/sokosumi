import { describe, expect, it } from "vitest";

import {
  buildOrganizationDesignMdMetadata,
  buildUserDesignMdMetadata,
} from "./design-md";

describe("buildUserDesignMdMetadata", () => {
  it("merges a DESIGN.md into existing metadata, preserving other fields", () => {
    const current = JSON.stringify({ url: "https://site.example" });
    const { serialized, persisted } = buildUserDesignMdMetadata(current, {
      url: "https://blob.example/design.md",
      extractionId: "123",
    });

    expect(persisted).toEqual({
      url: "https://blob.example/design.md",
      extractionId: "123",
    });
    expect(JSON.parse(serialized as string)).toMatchObject({
      url: "https://site.example",
      designMdUrl: "https://blob.example/design.md",
      designMdExtractionId: "123",
    });
  });

  it("returns null persisted when the DESIGN.md is cleared", () => {
    const current = JSON.stringify({
      designMdUrl: "https://blob.example/design.md",
      designMdExtractionId: "123",
    });
    const { persisted } = buildUserDesignMdMetadata(current, {
      url: null,
      extractionId: null,
    });

    expect(persisted).toBeNull();
  });

  it("accepts an already-parsed metadata object", () => {
    const { persisted } = buildUserDesignMdMetadata(
      { designMdUrl: null },
      { url: "https://blob.example/design.md", extractionId: null },
    );

    expect(persisted).toEqual({
      url: "https://blob.example/design.md",
      extractionId: null,
    });
  });
});

describe("buildOrganizationDesignMdMetadata", () => {
  it("merges a DESIGN.md into existing organization metadata", () => {
    const current = JSON.stringify({ invoiceEmail: "billing@acme.example" });
    const { serialized, persisted } = buildOrganizationDesignMdMetadata(
      current,
      { url: "https://blob.example/org.md", extractionId: "999" },
    );

    expect(persisted).toEqual({
      url: "https://blob.example/org.md",
      extractionId: "999",
    });
    expect(JSON.parse(serialized as string)).toMatchObject({
      invoiceEmail: "billing@acme.example",
      designMdUrl: "https://blob.example/org.md",
      designMdExtractionId: "999",
    });
  });

  it("returns null persisted when the organization DESIGN.md is cleared", () => {
    const current = JSON.stringify({
      designMdUrl: "https://blob.example/org.md",
    });
    const { persisted } = buildOrganizationDesignMdMetadata(current, {
      url: null,
      extractionId: null,
    });

    expect(persisted).toBeNull();
  });
});
