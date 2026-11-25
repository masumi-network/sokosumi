import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { CUSO_FACE_URL, sokoBotFace } from "@/lib/cuso-face";

describe("sokoBotFace", () => {
  const look = {
    avatarImageUrl: "https://blob.example/owl.webp",
    avatarCode: "v1.owl.sky",
  };

  it("gives every Cuso version the fixed face and no live look", () => {
    expect(
      sokoBotFace({ ...look, versionId: CMO_SOKO_BOT_VERSION_ID }),
    ).toEqual({ avatarImageUrl: CUSO_FACE_URL, avatarCode: null });
    expect(sokoBotFace({ ...look, versionId: "cmo-v4" })).toEqual({
      avatarImageUrl: CUSO_FACE_URL,
      avatarCode: null,
    });
  });

  it("keeps any other bot's own look", () => {
    expect(sokoBotFace({ ...look, versionId: "v29" })).toEqual(look);
    expect(sokoBotFace({ ...look, versionId: null })).toEqual(look);
    expect(sokoBotFace({ avatarImageUrl: null, versionId: null })).toEqual({
      avatarImageUrl: null,
      avatarCode: null,
    });
  });
});
