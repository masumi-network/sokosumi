import { describe, expect, it } from "vitest";

import {
  AVATAR_ANIMALS,
  AVATAR_BACKGROUNDS,
  AVATAR_COMBINATIONS,
  AVATAR_EYES,
  AVATAR_HATS,
  type AvatarLook,
  avatarCodeSchema,
  avatarStateOf,
  buildAvatarSvg,
  closestAvatarLooks,
  featureOptions,
  formatAvatarCode,
  isReadable,
  originalAvatarLook,
  parseAvatarCode,
  randomAvatarLook,
} from "../avatar/index.js";

const owl: AvatarLook = {
  animal: "owl",
  bg: "golden",
  body: "iris",
  mark: "sand",
  corner: "r",
  size: "L",
  eyes: "sleepy",
  mouth: "open",
  cheeks: "none",
  hat: "party",
};

/** A tiny seeded generator, so random looks are reproducible. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

describe("avatar codes", () => {
  it("round-trips a look through its code", () => {
    const code = formatAvatarCode(owl);
    expect(code).toBe("v1.owl.golden.iris.sand.r.L.sleepy.open.none.party");
    expect(parseAvatarCode(code)).toEqual(owl);
  });

  it("rejects unknown values, wrong versions and unreadable colours", () => {
    expect(
      parseAvatarCode("v1.dragon.golden.iris.sand.r.L.sleepy.open.none.party"),
    ).toBeNull();
    expect(
      parseAvatarCode("v2.owl.golden.iris.sand.r.L.sleepy.open.none.party"),
    ).toBeNull();
    expect(
      parseAvatarCode("v1.owl.golden.iris.sand.r.L.sleepy.open.none"),
    ).toBeNull();
    // A golden duckling on a golden background cannot be read.
    expect(
      parseAvatarCode(
        "v1.duckling.golden.golden.persimmon.l.M.original.original.none.none",
      ),
    ).toBeNull();
    expect(avatarCodeSchema.safeParse(formatAvatarCode(owl)).success).toBe(
      true,
    );
    expect(avatarCodeSchema.safeParse("v1.owl").success).toBe(false);
  });

  it("only offers a new mouth or blush where the drawing allows it", () => {
    // The cat's nose and mouth are one shape; the axolotl already has blush.
    expect(featureOptions("cat").mouth).toEqual(["original"]);
    expect(featureOptions("axolotl").cheeks).toEqual(["none"]);
    expect(
      parseAvatarCode("v1.cat.golden.ink.peach.r.M.original.smile.none.none"),
    ).toBeNull();
    expect(
      parseAvatarCode(
        "v1.axolotl.golden.sakura.crimson.l.M.original.original.blush.none",
      ),
    ).toBeNull();
  });

  it("follows the recipe's colour rules", () => {
    expect(isReadable("golden", "golden", "crimson")).toBe(false); // same family as the background
    expect(isReadable("iris", "peach", "crimson")).toBe(false); // pink on pink
    expect(isReadable("golden", "peach", "sakura")).toBe(false); // second colour too close to the body
    expect(isReadable("crimson", "peach", "crimson")).toBe(false); // second colour is the background
    expect(isReadable("golden", "peach", "electric")).toBe(true);
  });

  it("keeps every animal's own colours readable on its own background", () => {
    for (const animal of AVATAR_ANIMALS) {
      const look = originalAvatarLook(animal);
      expect(isReadable(look.bg, look.body, look.mark), animal).toBe(true);
      expect(parseAvatarCode(formatAvatarCode(look)), animal).toEqual(look);
    }
  });

  it("counts every combination the rules allow", () => {
    expect(AVATAR_COMBINATIONS).toBe(8_922_960);
  });

  it("draws only valid random looks", () => {
    const rand = seeded(7);
    for (let i = 0; i < 500; i++) {
      const look = randomAvatarLook(rand);
      expect(parseAvatarCode(formatAvatarCode(look))).toEqual(look);
    }
  });

  it("maps every pool picture to distinct readable looks, closest first", () => {
    for (const animal of AVATAR_ANIMALS) {
      for (const bg of AVATAR_BACKGROUNDS) {
        const looks = closestAvatarLooks(animal, bg);
        const codes = looks.map(formatAvatarCode);
        expect(new Set(codes).size).toBe(codes.length);
        for (const look of looks)
          expect(parseAvatarCode(formatAvatarCode(look))).toEqual(look);
        // Enough fallbacks for many bots sharing one picture's animal and background.
        expect(looks.length).toBeGreaterThanOrEqual(50);
        expect(looks[0]?.animal).toBe(animal);
        expect(looks[0]?.eyes).toBe("original");
        expect(looks[0]?.hat).toBe("none");
      }
    }
  });
});

describe("buildAvatarSvg", () => {
  it("builds every animal with every eye style and hat", () => {
    for (const animal of AVATAR_ANIMALS) {
      const base = originalAvatarLook(animal);
      for (const eyes of AVATAR_EYES) {
        for (const hat of AVATAR_HATS) {
          const svg = buildAvatarSvg({ ...base, eyes, hat });
          expect(svg.startsWith("<svg")).toBe(true);
          expect(svg).toContain('id="eye-l"');
          expect(svg).toContain('id="eye-r"');
          expect(svg).not.toContain("NaN");
          expect(svg).not.toContain("undefined");
        }
      }
    }
  });

  it("paints the chosen colours and mirrors to the other corner", () => {
    const own = originalAvatarLook("frog");
    const svg = buildAvatarSvg({
      ...own,
      bg: "crimson",
      body: "white",
      mark: "electric",
      corner: own.corner === "l" ? "r" : "l",
    });
    expect(svg).toContain(
      '<rect id="bg" x="0" y="0" width="1392" height="1392" fill="#460a23"/>',
    );
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain('fill="#ffd300"'); // the old golden body is gone
    expect(svg).toMatch(/scale\(-1 1\)/);
  });

  it("replaces only the mouth, and only when the animal has one", () => {
    const frog = originalAvatarLook("frog");
    const shapes = (svg: string) => (svg.match(/<path /g) ?? []).length;
    const smile = buildAvatarSvg({ ...frog, mouth: "smile" });
    // The drawn mouth path goes, the smile path comes: same count.
    expect(shapes(smile)).toBe(shapes(buildAvatarSvg(frog)));
    expect(smile).toContain("stroke-linecap");
  });

  it("adds blush only when asked", () => {
    const bear = originalAvatarLook("bear");
    const ovals = (svg: string) => (svg.match(/<ellipse /g) ?? []).length;
    expect(ovals(buildAvatarSvg({ ...bear, cheeks: "blush" }))).toBe(
      ovals(buildAvatarSvg(bear)) + 2,
    );
  });
});

describe("avatarStateOf", () => {
  const now = 1_000_000;
  it("ranks sleeping > error > needs you > working > thinking > done > idle", () => {
    expect(
      avatarStateOf({
        status: "PAUSED",
        pendingDecisions: 2,
        turnStatus: "RUNNING",
      }),
    ).toBe("sleeping");
    expect(avatarStateOf({ status: "ERROR", pendingDecisions: 2 })).toBe(
      "error",
    );
    expect(
      avatarStateOf({
        status: "IDLE",
        turnStatus: "FAILED",
        pendingDecisions: 1,
      }),
    ).toBe("error");
    expect(
      avatarStateOf({
        status: "RUNNING",
        pendingDecisions: 1,
        turnStatus: "RUNNING",
      }),
    ).toBe("needs_you");
    expect(avatarStateOf({ status: "RUNNING", turnStatus: "RUNNING" })).toBe(
      "working",
    );
    expect(avatarStateOf({ streaming: true })).toBe("working");
    expect(avatarStateOf({ status: "RUNNING", turnStatus: "QUEUED" })).toBe(
      "thinking",
    );
    expect(avatarStateOf({ turnStatus: "STARTING" })).toBe("thinking");
    expect(
      avatarStateOf({ status: "IDLE", finishedAt: now - 4_000, now }),
    ).toBe("done");
    expect(
      avatarStateOf({ status: "IDLE", finishedAt: now - 60_000, now }),
    ).toBe("idle");
    expect(avatarStateOf({})).toBe("idle");
  });
});
