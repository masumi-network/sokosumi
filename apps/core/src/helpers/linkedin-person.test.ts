import { describe, expect, it } from "vitest";

import { linkedInPersonId, linkedInPersonUrn } from "@/helpers/linkedin-person";

describe("linkedInPersonId", () => {
  it("keeps a bare id", () => {
    expect(linkedInPersonId("MTJ1egdrII")).toBe("MTJ1egdrII");
  });

  it("strips the person URN prefix", () => {
    expect(linkedInPersonId("urn:li:person:MTJ1egdrII")).toBe("MTJ1egdrII");
  });

  it("is idempotent", () => {
    expect(linkedInPersonId(linkedInPersonId("urn:li:person:abc"))).toBe("abc");
  });
});

describe("linkedInPersonUrn", () => {
  it("prefixes a bare id", () => {
    expect(linkedInPersonUrn("MTJ1egdrII")).toBe("urn:li:person:MTJ1egdrII");
  });

  it("does not double a full URN", () => {
    expect(linkedInPersonUrn("urn:li:person:MTJ1egdrII")).toBe(
      "urn:li:person:MTJ1egdrII",
    );
  });

  it("is idempotent", () => {
    expect(linkedInPersonUrn(linkedInPersonUrn("abc"))).toBe(
      "urn:li:person:abc",
    );
  });
});

describe("linkedInAuthorUrn", () => {
  it("posts as the Page a connection holds, and as the person otherwise", async () => {
    const { linkedInAuthorUrn, isLinkedInPage } = await import(
      "./linkedin-person"
    );
    expect(linkedInAuthorUrn("urn:li:organization:42")).toBe(
      "urn:li:organization:42",
    );
    expect(linkedInAuthorUrn("9Acyt0wAkf")).toBe("urn:li:person:9Acyt0wAkf");
    expect(isLinkedInPage("urn:li:person:9Acyt0wAkf")).toBe(false);
  });
});
