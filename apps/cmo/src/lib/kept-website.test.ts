import { expect, it } from "vitest";

import { KEPT_WEBSITE_OPTIONS, keptWebsite } from "./kept-website";

it("reads a kept website back as the founder would type it", () => {
  expect(keptWebsite("https://acme.io/")).toBe("acme.io");
  expect(keptWebsite("https://www.acme.io/en")).toBe("www.acme.io/en");
  expect(keptWebsite("acme.io")).toBe("acme.io");
});

it.each([
  ["nothing", undefined],
  ["an empty value", ""],
  ["a value that is no website", "not a site"],
])("keeps no website for %s", (_label, value) => {
  expect(keptWebsite(value)).toBeUndefined();
});

it("keeps it for a day, out of scripts' reach, through the sign-in return", () => {
  expect(KEPT_WEBSITE_OPTIONS).toMatchObject({
    httpOnly: true,
    // The sign-in returns to CMO by a top-level GET from Sokosumi.
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
});
