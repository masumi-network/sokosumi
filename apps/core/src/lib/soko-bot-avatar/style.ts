/**
 * Avatar style definitions. A style is data: the pipeline (draft, keep, render,
 * reconcile) takes one as input and never names a creature, desk, pot or colour
 * itself. This file is the only place that does. A new style is a new entry in
 * {@link AVATAR_STYLES}; the pipeline does not change.
 */

export const AVATAR_STATES = [
  "idle",
  "thinking",
  "working",
  "done",
  "needs_you",
  "offline",
] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];

/**
 * One value per state. Spelled out so the compiler fails here when a state is
 * added to {@link AVATAR_STATES}, instead of a cast hiding a missing key.
 */
export function mapAvatarStates<T>(
  make: (state: AvatarState) => T,
): Record<AvatarState, T> {
  return {
    idle: make("idle"),
    thinking: make("thinking"),
    working: make("working"),
    done: make("done"),
    needs_you: make("needs_you"),
    offline: make("offline"),
  };
}

/** One choice on a trait axis, with the words a prompt uses for it. */
export interface TraitOption {
  id: string;
  phrase: string;
}

/**
 * The trait every creature has: its colouring. Each creature lists its own
 * coats, and the coat at the same index is its counterpart on another creature.
 */
export const COAT_TRAIT = "coat";

/**
 * A detail of the scene a look varies on. Drawn from the row's seed, so the
 * same seed is always the same scene.
 */
export interface TraitAxis {
  id: string;
  /** One sentence of a prompt; `{phrase}` is the chosen option. */
  template: string;
  /** Whether a clash with another bot's look may re-roll it (not the person's own choice). */
  rerollable: boolean;
  options: readonly TraitOption[];
}

/** A creature the look can be swapped to. The colour is named to stop drift. */
export interface AvatarCreature {
  id: string;
  /** The word state prompts use for it ("the {c} looks up"). */
  noun: string;
  /** How the creature is introduced when it is swapped in, one per coat. */
  coats: readonly TraitOption[];
}

export interface AvatarAccessory {
  id: string;
  phrase: string;
}

/**
 * A style is a set of prompts and assets. Creature and accessory are the axes
 * of a look, which is what the studio API offers; a style whose look has no
 * creature (or no accessories) lists one creature and no accessories.
 */
export interface SokoBotAvatarStyle {
  id: string;
  version: number;
  /** File under `assets/soko-bot-avatar/` showing the house look. */
  houseScene: string;
  /** The creature the house scene shows. */
  houseCreatureId: string;
  /** Sent as the system message of every image edit. */
  housePrompt: string;
  /** Appended to the house prompt for the typed-change rewriter. */
  rewriterRules: string;
  creatures: readonly AvatarCreature[];
  accessories: readonly AvatarAccessory[];
  /** Scene details besides the creature's coat. The first option of each is the house scene's. */
  traits: readonly TraitAxis[];
  /**
   * Templates. `{from}`, `{to}`, `{c}`, `{accessory}`, `{worn}`, `{traits}` are
   * filled by the pipeline.
   */
  prompts: {
    /** A fresh look: the house scene redrawn with new traits. */
    freshLook: string;
    /** Added to an edit that re-rolled scene details to keep the look unique. */
    alsoChange: string;
    swapCreature: string;
    /** Added to a swap when the new creature wears accessories. */
    wearing: string;
    addAccessory: string;
    removeAccessory: string;
    /** Appended to every state still so the framing does not drift. */
    stillFraming: string;
    stills: Record<Exclude<AvatarState, "idle">, string>;
    loops: Record<AvatarState, string>;
    /** Appended to every loop prompt. */
    loopSuffix: string;
  };
  /** Gray level (0-255) the background of a still or loop lands on. */
  backgroundTarget: (state: AvatarState) => number;
}

const HOUSE_PROMPT = `You edit one image of a Soko Bot avatar: a tiny handmade clay creature at work at its little wooden desk, standing on a very light neutral gray background. The attached image is the bot's current look. Apply the requester's change to the creature or its little scene, and return the edited image.

House rules. They win over the requester's request:
- No dome, no base, no frame, no room: the creature and its desk stand directly on a flat, evenly lit, very light neutral gray background (#F5F5F5, no warm or beige tint, no vignette) with a soft contact shadow.
- The small flower pot is always matte clay in Iris Flower pink (#FF51FF), the brand accent. Keep it.
- Keep the camera angle, the soft daylight and the framing: the creature and its desk fill most of the square, with the creature's face near the centre, slightly above the middle.
- Keep the same creature: same species, face, proportions and colours, unless the requester asks for a different creature.
- Anything new is made of the same soft matte clay or miniature craft materials, at the same scale, on or around the desk.
- One creature only.
- No text, letters, numbers, logos or brands. No real people, celebrities or copyrighted characters. Nothing scary, violent or adult.
- If part of the request breaks a rule, apply only the parts that fit and leave the rest unchanged.`;

const REWRITER_RULES = `You do not edit the image. You rewrite the requester's request into one short edit instruction for the image model that follows every house rule.
- Keep what fits. Turn scenery into a miniature around the desk (a beach becomes a patch of sand, a few shells and a tiny wave by the desk).
- Drop anything a rule forbids (logos, text, real people, adding a dome, frame or room). For logos and text, a plain shape is fine.
- Real people, brands and copyrighted characters: never offer a look-alike, a costume or a "closest" version. Do not combine a known character's signature features (for example a black dome helmet with a breathing mask and black cape, or yellow fur with red cheeks and a lightning-bolt tail). Treat a request that describes a known character's signature look without naming it exactly as if it named the character. Leave the image unchanged and suggest an unrelated original idea in the note.
- A change of creature is fine: any real or mythical animal, as one original clay creature.
- If nothing fits, set "edit" to "".
Answer with JSON only: {"edit": "...", "note": "one short sentence to the requester about anything you changed, or empty"}`;

export const CRAFTED_DESK_STYLE: SokoBotAvatarStyle = {
  id: "crafted-desk",
  version: 1,
  houseScene: "crafted-desk-house.jpg",
  houseCreatureId: "owl",
  housePrompt: HOUSE_PROMPT,
  rewriterRules: REWRITER_RULES,
  creatures: [
    {
      id: "owl",
      noun: "owl",
      coats: [
        { id: "tan", phrase: "tan owl with a cream face" },
        { id: "snowy", phrase: "snowy white owl with grey-tipped feathers" },
        { id: "tawny", phrase: "tawny owl with dark barred feathers" },
        { id: "grey", phrase: "soft grey owl with a white face" },
      ],
    },
    {
      id: "frog",
      noun: "frog",
      coats: [
        { id: "bright", phrase: "bright green frog" },
        { id: "olive", phrase: "olive green frog with darker spots" },
        { id: "teal", phrase: "teal green frog with a pale yellow belly" },
        { id: "lime", phrase: "lime yellow frog with brown speckles" },
      ],
    },
    {
      id: "hedgehog",
      noun: "hedgehog",
      coats: [
        { id: "chestnut", phrase: "brown hedgehog with chestnut quills" },
        { id: "silver", phrase: "grey hedgehog with silver-tipped quills" },
        { id: "sandy", phrase: "cream hedgehog with sandy quills" },
        {
          id: "russet",
          phrase: "dark brown hedgehog with russet-tipped quills",
        },
      ],
    },
    {
      id: "otter",
      noun: "otter",
      coats: [
        { id: "chocolate", phrase: "brown otter with chocolate fur" },
        { id: "honey", phrase: "honey gold otter with a cream muzzle" },
        { id: "slate", phrase: "dark grey-brown otter with a pale chest" },
        { id: "ginger", phrase: "ginger otter with a white belly" },
      ],
    },
    {
      id: "penguin",
      noun: "penguin",
      coats: [
        { id: "classic", phrase: "black and white penguin" },
        { id: "blue", phrase: "grey-blue penguin with a white belly" },
        { id: "gold", phrase: "black penguin with a golden-yellow neck patch" },
        {
          id: "charcoal",
          phrase: "penguin with a charcoal back and a cream belly",
        },
      ],
    },
  ],
  accessories: [
    { id: "beanie", phrase: "a small knitted red beanie" },
    { id: "glasses", phrase: "round gold wire-rimmed glasses" },
    { id: "scarf", phrase: "a cream and green striped knitted scarf" },
    { id: "headphones", phrase: "small brown over-ear headphones" },
    {
      id: "magnifier",
      phrase: "a small brass magnifying glass, held up in one hand",
    },
  ],
  traits: [
    {
      id: "plant",
      template: "The pink pot holds {phrase}.",
      rerollable: false,
      options: [
        { id: "round-leaf", phrase: "a small round-leaf plant" },
        { id: "cactus", phrase: "a tiny green cactus" },
        { id: "fern", phrase: "a small fern" },
        { id: "succulent", phrase: "a little succulent rosette" },
        { id: "lavender", phrase: "a sprig of lavender" },
      ],
    },
    {
      id: "deskItem",
      template: "On the desk: {phrase}.",
      rerollable: true,
      options: [
        { id: "none", phrase: "only the open book" },
        { id: "mug", phrase: "the open book and a tiny steaming mug" },
        { id: "lamp", phrase: "the open book and a small brass desk lamp" },
        { id: "pencils", phrase: "the open book and a pencil cup" },
        { id: "clock", phrase: "the open book and a little alarm clock" },
      ],
    },
    {
      id: "books",
      template: "The stack of books beside the desk has {phrase} covers.",
      rerollable: true,
      options: [
        { id: "green-brown", phrase: "green and brown" },
        { id: "navy-mustard", phrase: "navy and mustard" },
        { id: "red-cream", phrase: "red and cream" },
        { id: "teal-plum", phrase: "teal and plum" },
      ],
    },
  ],
  prompts: {
    freshLook:
      "Redraw this scene as a new variation of the same handmade clay miniature, with the same camera, framing, daylight and background. The creature is a {to}, made in the same soft clay style and size, doing the same thing: reading the open book with both hands resting on the desk.{worn} {traits} Keep the desk itself, the pot's pink, the framing and the background exactly the same.",
    alsoChange: " Also change these details of the scene: {traits}",
    swapCreature:
      "Replace the {from} with a {to} made in the same soft clay style and size, doing the same thing: reading the open book with both hands resting on the desk.{worn} Keep the desk, the props, the framing and the background exactly the same.",
    wearing: " It wears {worn}.",
    addAccessory:
      "Give the {c} {accessory}, made in the same soft clay style. Keep everything the {c} already wears. The {c} must stay the same {c}: same face, same pose. Keep the desk, the props, the framing and the background exactly the same.",
    removeAccessory:
      "Take off the {accessory} the {c} wears. Keep everything else the {c} wears. The {c} must stay the same {c}: same face, same pose. Keep the desk, the props, the framing and the background exactly the same.",
    stillFraming:
      " Keep the exact same framing and zoom as the attached image, the same background and the pink pot.",
    stills: {
      thinking:
        "The {c} looks up thoughtfully from the book, one hand at its chin.",
      working:
        "The {c} leans in and reads the open book closely, one hand turning a page.",
      done: "The {c} has closed the book and smiles contentedly, eyes squeezed into happy curves.",
      needs_you:
        "The {c} looks straight at the viewer with a friendly expression and raises one hand high above its head in a clear, open wave.",
      offline:
        "The {c} is asleep, eyes closed, head resting on the closed book. The light is a little softer and dimmer; the background stays the same neutral gray, only slightly darker.",
    },
    loops: {
      idle: "The {c} slowly blinks and a leaf of the plant stirs.",
      thinking:
        "The {c}'s eyes drift slowly upward and its head tilts a little.",
      working:
        "The {c} reads, its eyes move along the lines and it turns a page.",
      done: "The {c} gives a small happy bounce.",
      needs_you: "The {c} waves its raised hand gently.",
      offline: "The {c} breathes slowly in its sleep.",
    },
    loopSuffix:
      " Subtle, gentle motion only. Locked-off camera, no zoom, no pan. The scene, lighting and background stay exactly the same. Ends exactly where it starts so it loops seamlessly.",
  },
  // #F5F5F5; asleep is a little dimmer.
  backgroundTarget: (state) => (state === "offline" ? 215 : 245),
};

/**
 * Legacy mascot recipe. Rows made by it are read, never drawn: it has no
 * creatures, no prompts, and no entry in {@link AVATAR_STYLES}.
 */
export const LEGACY_AVATAR_STYLE_ID = "mascot";

export const AVATAR_STYLES: Record<string, SokoBotAvatarStyle> = {
  [CRAFTED_DESK_STYLE.id]: CRAFTED_DESK_STYLE,
};

/** The style new looks are drawn in. */
export const CURRENT_AVATAR_STYLE = CRAFTED_DESK_STYLE;

/** The style a stored row was drawn in, or `null` for a legacy or unknown one. */
export function findAvatarStyle(id: string): SokoBotAvatarStyle | null {
  return AVATAR_STYLES[id] ?? null;
}

/** What a look is made of. Stored on the avatar row. */
// A type, not an interface: it is stored as JSON.
export type AvatarLook = {
  creature: string;
  accessories: string[];
  /** Rewritten typed changes applied so far. */
  typed: string[];
  /**
   * The chosen option id per trait axis: the creature's coat and the style's
   * scene details. Absent on looks drawn before traits existed.
   */
  traits?: Record<string, string>;
};

/** The look the house scene shows: its creature, the first option of every trait. */
export function freshLook(style: SokoBotAvatarStyle): AvatarLook {
  return {
    creature: style.houseCreatureId,
    accessories: [],
    typed: [],
    traits: Object.fromEntries([
      [COAT_TRAIT, creatureOf(style, style.houseCreatureId).coats[0]?.id ?? ""],
      ...style.traits.map((axis) => [axis.id, axis.options[0]?.id ?? ""]),
    ]),
  };
}

export function creatureOf(
  style: SokoBotAvatarStyle,
  id: string,
): AvatarCreature {
  return (
    style.creatures.find((one) => one.id === id) ??
    // A look drawn by an older version of this style may name a creature the
    // style no longer offers; the house creature keeps prompts sensible.
    style.creatures.find((one) => one.id === style.houseCreatureId)!
  );
}

/** A small seeded PRNG (mulberry32): the same seed always rolls the same numbers. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

/**
 * A whole look from a seed: creature, coat, scene details and at most one
 * accessory. The seed is stored on the row, so the look can be read back from it.
 */
export function lookFromSeed(
  style: SokoBotAvatarStyle,
  seed: number,
): AvatarLook {
  const random = seededRandom(seed);
  const creature = pickFrom(style.creatures, random);
  const traits: Record<string, string> = {
    [COAT_TRAIT]: pickFrom(creature.coats, random).id,
  };
  for (const axis of style.traits) {
    traits[axis.id] = pickFrom(axis.options, random).id;
  }
  // Nothing, or one of the accessories, with equal odds each.
  const slot = Math.floor(random() * (style.accessories.length + 1));
  const accessory = style.accessories[slot];
  return {
    creature: creature.id,
    accessories: accessory ? [accessory.id] : [],
    typed: [],
    traits,
  };
}

/**
 * What identifies a look among others: creature, traits and accessories. Typed
 * changes are not part of it. Null for a look without traits (a legacy one).
 */
export function traitKeyOf(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
): string | null {
  const { traits } = look;
  if (!traits) return null;
  return [
    look.creature,
    traits[COAT_TRAIT] ?? "",
    ...style.traits.map((axis) => traits[axis.id] ?? ""),
    [...look.accessories].sort().join("+") || "none",
  ].join("|");
}

/** The coat the same-index coat of another creature stands for. */
export function coatAfterSwap(
  style: SokoBotAvatarStyle,
  from: AvatarLook,
  toCreatureId: string,
): string | undefined {
  const index = creatureOf(style, from.creature).coats.findIndex(
    (coat) => coat.id === from.traits?.[COAT_TRAIT],
  );
  const coats = creatureOf(style, toCreatureId).coats;
  return coats[Math.max(0, Math.min(index, coats.length - 1))]?.id;
}

/** The phrase of a look's coat, falling back to the creature's first coat. */
export function coatPhrase(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
): string {
  const creature = creatureOf(style, look.creature);
  return (
    (
      creature.coats.find((coat) => coat.id === look.traits?.[COAT_TRAIT]) ??
      creature.coats[0]
    )?.phrase ?? creature.noun
  );
}

/** One sentence per scene-detail axis (or just `only` of them), from a look's traits. */
export function traitSentences(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
  only?: readonly string[],
): string {
  return style.traits
    .filter((axis) => !only || only.includes(axis.id))
    .flatMap((axis) => {
      const option = axis.options.find(
        (one) => one.id === look.traits?.[axis.id],
      );
      return option ? [fill(axis.template, { phrase: option.phrase })] : [];
    })
    .join(" ");
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

function wearing(
  style: SokoBotAvatarStyle,
  accessories: readonly AvatarAccessory[],
): string {
  return accessories.length
    ? fill(style.prompts.wearing, {
        worn: accessories.map((one) => one.phrase).join(" and "),
      })
    : "";
}

/** The prompt that redraws the house scene as a fresh look. */
export function freshLookPrompt(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
  accessories: readonly AvatarAccessory[],
): string {
  return fill(style.prompts.freshLook, {
    to: coatPhrase(style, look),
    worn: wearing(style, accessories),
    traits: traitSentences(style, look),
  });
}

/** What to append to an edit that re-rolled the scene details in `axes`. */
export function alsoChangePrompt(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
  axes: readonly string[],
): string {
  return fill(style.prompts.alsoChange, {
    traits: traitSentences(style, look, axes),
  });
}

/** The prompt for the one image edit that swaps the creature, keeping the scene. */
export function creatureSwapPrompt(
  style: SokoBotAvatarStyle,
  from: AvatarCreature,
  to: string,
  accessories: readonly AvatarAccessory[],
): string {
  return fill(style.prompts.swapCreature, {
    from: from.noun,
    to,
    worn: wearing(style, accessories),
  });
}

export function accessoryPrompt(
  style: SokoBotAvatarStyle,
  creature: AvatarCreature,
  accessory: AvatarAccessory,
): string {
  return fill(style.prompts.addAccessory, {
    c: creature.noun,
    accessory: accessory.phrase,
  });
}

export function removeAccessoryPrompt(
  style: SokoBotAvatarStyle,
  creature: AvatarCreature,
  accessory: AvatarAccessory,
): string {
  return fill(style.prompts.removeAccessory, {
    c: creature.noun,
    accessory: accessory.phrase,
  });
}

export function stillPrompt(
  style: SokoBotAvatarStyle,
  state: Exclude<AvatarState, "idle">,
  creature: AvatarCreature,
): string {
  return (
    fill(style.prompts.stills[state], { c: creature.noun }) +
    style.prompts.stillFraming
  );
}

export function loopPrompt(
  style: SokoBotAvatarStyle,
  state: AvatarState,
  creature: AvatarCreature,
): string {
  return (
    fill(style.prompts.loops[state], { c: creature.noun }) +
    style.prompts.loopSuffix
  );
}
