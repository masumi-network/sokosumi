import { describe, expect, it } from "vitest";

import { rerollDetails } from "./draw";
import {
  alsoChangePrompt,
  COAT_TRAIT,
  coatAfterSwap,
  freshLook,
  freshLookPrompt,
  lookFromSeed,
  seededRandom,
  CRAFTED_DESK_STYLE as style,
  traitKeyOf,
} from "./style";

describe("seeded looks", () => {
  it("rolls the same numbers for the same seed", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(43)()).not.toBe(seededRandom(42)());
  });

  it("makes the same look from the same seed, and a different one from another", () => {
    expect(lookFromSeed(style, 1234)).toEqual(lookFromSeed(style, 1234));
    const looks = new Set(
      Array.from({ length: 200 }, (_, seed) =>
        traitKeyOf(style, lookFromSeed(style, seed + 1)),
      ),
    );
    // Nearly every seed is its own combination.
    expect(looks.size).toBeGreaterThan(180);
  });

  it("only ever picks real options, with a coat of the creature's own", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const look = lookFromSeed(style, seed);
      const creature = style.creatures.find((one) => one.id === look.creature);
      expect(creature?.coats.map((coat) => coat.id)).toContain(
        look.traits?.[COAT_TRAIT],
      );
      for (const axis of style.traits) {
        expect(axis.options.map((option) => option.id)).toContain(
          look.traits?.[axis.id],
        );
      }
      expect(look.accessories.length).toBeLessThanOrEqual(1);
    }
  });

  it("reaches every option on every axis", () => {
    const seen = new Map<string, Set<string>>();
    for (let seed = 1; seed <= 3000; seed += 1) {
      const look = lookFromSeed(style, seed);
      for (const [axis, option] of Object.entries(look.traits ?? {})) {
        const key = axis === COAT_TRAIT ? `${look.creature}:${axis}` : axis;
        seen.set(key, (seen.get(key) ?? new Set()).add(option));
      }
      seen.set(
        "creature",
        (seen.get("creature") ?? new Set()).add(look.creature),
      );
      seen.set(
        "accessory",
        (seen.get("accessory") ?? new Set()).add(look.accessories[0] ?? "none"),
      );
    }

    expect(seen.get("creature")?.size).toBe(5);
    expect(seen.get("plant")?.size).toBe(5);
    expect(seen.get("deskItem")?.size).toBe(5);
    expect(seen.get("books")?.size).toBe(4);
    expect(seen.get("accessory")?.size).toBe(6);
    for (const creature of style.creatures) {
      expect(seen.get(`${creature.id}:${COAT_TRAIT}`)?.size).toBe(4);
    }
  });

  it("offers about twelve thousand combinations", () => {
    const coats = style.creatures.reduce(
      (sum, one) => sum + one.coats.length,
      0,
    );
    const scene = style.traits.reduce((n, axis) => n * axis.options.length, 1);

    expect(coats * scene * (style.accessories.length + 1)).toBe(12_000);
  });
});

describe("the house look", () => {
  it("starts every axis at the option the house scene shows", () => {
    expect(freshLook(style).traits).toEqual({
      coat: "tan",
      plant: "round-leaf",
      deskItem: "none",
      books: "green-brown",
    });
  });
});

describe("the trait key", () => {
  it("names creature, coat, scene details and accessory, and ignores typed changes", () => {
    const look = {
      creature: "otter",
      accessories: ["scarf"],
      typed: ["a tiny hat"],
      traits: {
        coat: "honey",
        plant: "fern",
        deskItem: "mug",
        books: "red-cream",
      },
    };

    expect(traitKeyOf(style, look)).toBe(
      "otter|honey|fern|mug|red-cream|scarf",
    );
    expect(traitKeyOf(style, { ...look, typed: [] })).toBe(
      traitKeyOf(style, look),
    );
    expect(traitKeyOf(style, { ...look, accessories: [] })).toMatch(/\|none$/);
  });

  it("is null for a look drawn before traits existed", () => {
    expect(
      traitKeyOf(style, { creature: "owl", accessories: [], typed: [] }),
    ).toBeNull();
  });
});

describe("fresh look prompts", () => {
  it("names the coat and every scene detail, and keeps the framing and the pink pot", () => {
    const look = {
      creature: "otter",
      accessories: ["glasses"],
      typed: [],
      traits: {
        coat: "honey",
        plant: "cactus",
        deskItem: "lamp",
        books: "navy-mustard",
      },
    };

    const prompt = freshLookPrompt(style, look, [
      { id: "glasses", phrase: "round gold wire-rimmed glasses" },
    ]);

    expect(prompt).toBe(
      "Redraw this scene as a new variation of the same handmade clay miniature, with the same camera, framing, daylight and background. The creature is a honey gold otter with a cream muzzle, made in the same soft clay style and size, doing the same thing: reading the open book with both hands resting on the desk. It wears round gold wire-rimmed glasses. The pink pot holds a tiny green cactus. On the desk: the open book and a small brass desk lamp. The stack of books beside the desk has navy and mustard covers. Keep the desk itself, the pot's pink, the framing and the background exactly the same.",
    );
  });
});

describe("a creature swap keeps the coat's place", () => {
  it("maps the coat to the same index on the new creature", () => {
    const owl = {
      ...freshLook(style),
      traits: { ...freshLook(style).traits, coat: "tawny" },
    };

    // Tawny is the third owl coat; the third otter coat is slate.
    expect(coatAfterSwap(style, owl, "otter")).toBe("slate");
    expect(coatAfterSwap(style, freshLook(style), "frog")).toBe("bright");
  });
});

describe("re-rolling scene details", () => {
  const look = {
    creature: "frog",
    accessories: ["beanie"],
    typed: [],
    traits: {
      coat: "olive",
      plant: "fern",
      deskItem: "none",
      books: "green-brown",
    },
  };

  it("changes only the desk item and the books, never the person's own choices", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const { look: rolled, axes } = rerollDetails(style, look, seed);

      expect(rolled.creature).toBe("frog");
      expect(rolled.accessories).toEqual(["beanie"]);
      expect(rolled.traits?.coat).toBe("olive");
      expect(rolled.traits?.plant).toBe("fern");
      for (const axis of axes) expect(["deskItem", "books"]).toContain(axis);
    }
  });

  it("is deterministic and says what it changed, in a prompt", () => {
    // Some seeds draw what is already there; take one that changes something.
    const seed = Array.from({ length: 50 }, (_, i) => i + 1).find(
      (one) => rerollDetails(style, look, one).axes.length > 0,
    ) as number;
    const first = rerollDetails(style, look, seed);

    expect(rerollDetails(style, look, seed)).toEqual(first);
    expect(first.axes.length).toBeGreaterThan(0);
    expect(alsoChangePrompt(style, first.look, first.axes)).toMatch(
      /^ Also change these details of the scene: /,
    );
  });
});
