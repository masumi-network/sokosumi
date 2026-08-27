import { describe, expect, it } from "vitest";

import {
  buildProjectLogoContentHashPathname,
  buildProjectLogoPrefix,
  isOwnedProjectLogoUrl,
  isProjectLogoBlobUrl,
} from "./project-logo-path.js";

const PROJECT_ID = "01960001-0001-7001-8001-000000000088";

describe("project logo paths", () => {
  it("builds project-owned prefix and content hash path", () => {
    const hash =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(buildProjectLogoPrefix(PROJECT_ID)).toBe(
      `projects/${PROJECT_ID}/logos/`,
    );
    expect(buildProjectLogoContentHashPathname(PROJECT_ID, hash)).toBe(
      `projects/${PROJECT_ID}/logos/${hash}`,
    );
  });

  it("accepts only matching project-owned public blob URLs", () => {
    const owned = `https://abc.public.blob.vercel-storage.com/projects/${PROJECT_ID}/logos/hash.png`;

    expect(isOwnedProjectLogoUrl(owned, PROJECT_ID)).toBe(true);
    expect(isProjectLogoBlobUrl(owned)).toBe(true);
    expect(isOwnedProjectLogoUrl(owned, "other-project")).toBe(false);
    expect(
      isOwnedProjectLogoUrl(
        `https://evil.example/projects/${PROJECT_ID}/logos/hash.png`,
        PROJECT_ID,
      ),
    ).toBe(false);
  });

  it("rejects malformed and non-project logo URLs", () => {
    expect(isProjectLogoBlobUrl("not-a-url")).toBe(false);
    expect(
      isProjectLogoBlobUrl(
        "https://abc.public.blob.vercel-storage.com/projects/project/logotype.png",
      ),
    ).toBe(false);
  });
});
