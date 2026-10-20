import { afterEach, describe, expect, it } from "vitest";

import {
  clearSocialComposePrefill,
  peekSocialComposePrefill,
  writeSocialComposePrefill,
} from "./social-compose-prefill";

const PROJECT_ID = "project-1";
const MEDIA = {
  pathname: "drive/users/user-1/Content Studio/fox.png",
  fileUrl: "https://store.public.blob.vercel-storage.com/fox.png",
  name: "fox.png",
  size: 12,
  mimeType: "image/png",
  kind: "image" as const,
};

afterEach(() => {
  sessionStorage.clear();
});

describe("social compose prefill", () => {
  it("reads back the media written for a project", () => {
    writeSocialComposePrefill(PROJECT_ID, { media: [MEDIA] });
    expect(peekSocialComposePrefill(PROJECT_ID)).toEqual({ media: [MEDIA] });
  });

  it("keeps optional text for a later caption", () => {
    writeSocialComposePrefill(PROJECT_ID, {
      media: [MEDIA],
      text: "Launch day.",
    });
    expect(peekSocialComposePrefill(PROJECT_ID)?.text).toBe("Launch day.");
  });

  it("ignores another project's prefill", () => {
    writeSocialComposePrefill(PROJECT_ID, { media: [MEDIA] });
    expect(peekSocialComposePrefill("project-2")).toBeNull();
  });

  it("drops junk left in storage", () => {
    sessionStorage.setItem(
      `sokosumi.social-compose.${PROJECT_ID}`,
      '{"media":[{"name":"nope"}]}',
    );
    expect(peekSocialComposePrefill(PROJECT_ID)).toBeNull();
  });

  it("clears the project slot", () => {
    writeSocialComposePrefill(PROJECT_ID, { media: [MEDIA] });
    clearSocialComposePrefill(PROJECT_ID);
    expect(peekSocialComposePrefill(PROJECT_ID)).toBeNull();
  });
});
