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

/** A creature the look can be swapped to. The colour is named to stop drift. */
export interface AvatarCreature {
  id: string;
  /** The word state prompts use for it ("the {c} looks up"). */
  noun: string;
  /** How the creature is introduced when it is swapped in. */
  description: string;
}

export interface AvatarAccessory {
  id: string;
  phrase: string;
}

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
  /**
   * Templates. `{from}`, `{to}`, `{c}`, `{accessory}`, `{worn}` are filled by
   * the pipeline.
   */
  prompts: {
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

const HOUSE_PROMPT = `You edit one image of a Soko Bot avatar: a tiny handmade clay creature at work at its little wooden desk, standing on a very light neutral gray background. The attached image is the bot's current look. Apply the owner's change to the creature or its little scene, and return the edited image.

House rules. They win over the owner's request:
- No dome, no base, no frame, no room: the creature and its desk stand directly on a flat, evenly lit, very light neutral gray background (#F5F5F5, no warm or beige tint, no vignette) with a soft contact shadow.
- The small flower pot is always matte clay in Iris Flower pink (#FF51FF), the brand accent. Keep it.
- Keep the camera angle, the soft daylight and the framing: the creature and its desk fill most of the square, with the creature's face near the centre, slightly above the middle.
- Keep the same creature: same species, face, proportions and colours, unless the owner asks for a different creature.
- Anything new is made of the same soft matte clay or miniature craft materials, at the same scale, on or around the desk.
- One creature only.
- No text, letters, numbers, logos or brands. No real people, celebrities or copyrighted characters. Nothing scary, violent or adult.
- If part of the request breaks a rule, apply only the parts that fit and leave the rest unchanged.`;

const REWRITER_RULES = `You do not edit the image. You rewrite the owner's request into one short edit instruction for the image model that follows every house rule.
- Keep what fits. Turn scenery into a miniature around the desk (a beach becomes a patch of sand, a few shells and a tiny wave by the desk).
- Drop anything a rule forbids (logos, text, real people, adding a dome, frame or room). For logos and text, a plain shape is fine.
- Real people, brands and copyrighted characters: never offer a look-alike, a costume or a "closest" version. Do not combine a known character's signature features (for example a black dome helmet with a breathing mask and black cape, or yellow fur with red cheeks and a lightning-bolt tail). Treat a request that describes a known character's signature look without naming it exactly as if it named the character. Leave the image unchanged and suggest an unrelated original idea in the note.
- A change of creature is fine: any real or mythical animal, as one original clay creature.
- If nothing fits, set "edit" to "".
Answer with JSON only: {"edit": "...", "note": "one short sentence to the owner about anything you changed, or empty"}`;

export const CRAFTED_DESK_STYLE: SokoBotAvatarStyle = {
  id: "crafted-desk",
  version: 1,
  houseScene: "crafted-desk-house.jpg",
  houseCreatureId: "owl",
  housePrompt: HOUSE_PROMPT,
  rewriterRules: REWRITER_RULES,
  creatures: [
    { id: "owl", noun: "owl", description: "tan owl with a cream face" },
    { id: "frog", noun: "frog", description: "bright green frog" },
    {
      id: "hedgehog",
      noun: "hedgehog",
      description: "brown hedgehog with chestnut quills",
    },
    {
      id: "otter",
      noun: "otter",
      description: "brown otter with chocolate fur",
    },
    {
      id: "penguin",
      noun: "penguin",
      description: "black and white penguin",
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
  prompts: {
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
};

export function freshLook(style: SokoBotAvatarStyle): AvatarLook {
  return { creature: style.houseCreatureId, accessories: [], typed: [] };
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

/** The prompt for the one image edit that turns `look` into `next`. */
export function creatureSwapPrompt(
  style: SokoBotAvatarStyle,
  from: AvatarCreature,
  to: AvatarCreature,
  accessories: readonly AvatarAccessory[],
): string {
  const worn = accessories.length
    ? fill(style.prompts.wearing, {
        worn: accessories.map((one) => one.phrase).join(" and "),
      })
    : "";
  return fill(style.prompts.swapCreature, {
    from: from.noun,
    to: to.description,
    worn,
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
