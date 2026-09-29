import { describe, expect, it } from "vitest";

import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";

describe("socialPostPublishedUrl", () => {
  it.each([
    ["x", "sokosumi", "1907", "https://x.com/sokosumi/status/1907"],
    ["x", null, "1907", "https://x.com/i/web/status/1907"],
    [
      "linkedin",
      null,
      "urn:li:share:7",
      "https://www.linkedin.com/feed/update/urn:li:share:7",
    ],
    [
      "facebook",
      null,
      "page_1_post_2",
      "https://www.facebook.com/page_1_post_2",
    ],
    ["youtube", null, "vid_1", "https://www.youtube.com/watch?v=vid_1"],
    ["instagram", "alice", "media_1", null],
    ["tiktok", "alice", "pub_1", null],
  ] as const)("%s with handle %s resolves %s", (provider, handle, id, url) => {
    expect(socialPostPublishedUrl(provider, handle, id)).toBe(url);
  });
});
