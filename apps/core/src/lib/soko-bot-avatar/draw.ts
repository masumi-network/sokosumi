import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type { z } from "@hono/zod-openapi";
import { put } from "@vercel/blob";
import { getEnv } from "@/config/env";
import { unprocessableEntity } from "@/helpers/error";
import { buildSokoBotAvatarBlobPathname } from "@/helpers/soko-bot-avatar-blob-path";
import { levelStill } from "@/lib/soko-bot-avatar/media";
import { avatarProvider } from "@/lib/soko-bot-avatar/provider";
import {
  type AvatarAccessory,
  type AvatarLook,
  accessoryPrompt,
  COAT_TRAIT,
  coatAfterSwap,
  coatPhrase,
  creatureOf,
  creatureSwapPrompt,
  freshLookPrompt,
  lookFromSeed,
  removeAccessoryPrompt,
  type SokoBotAvatarStyle,
  seededRandom,
} from "@/lib/soko-bot-avatar/style";
import type { sokoBotAvatarChangeSchema } from "@/schemas/soko-bot-avatar.schema";

/**
 * Style-agnostic drawing: turn one change into one edit prompt, run it through
 * the provider, and level the result. Every name that reaches a prompt comes
 * from the style it is given.
 */

export type AvatarChange = z.infer<typeof sokoBotAvatarChangeSchema>;

const ASSET_TIMEOUT_MS = 60_000;
/** Typed changes kept on a look; older ones are dropped, they are only a record. */
const MAX_TYPED_CHANGES = 10;

/** A short, bounded reason for logs and `lastError`. */
export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : "unknown").slice(0, 300);
}

export { creatureOf };

/** One image edit, planned. `note` is the rewriter's sentence for the person editing. */
export type AvatarPlan =
  | { kind: "edit"; look: AvatarLook; prompt: string; note: string }
  | { kind: "unchanged"; note: string };

/** A random seed for a fresh look; the look itself is read back from it. */
export function randomSeed(): number {
  return crypto.randomInt(1, 2 ** 31 - 1);
}

export function accessoriesOf(
  style: SokoBotAvatarStyle,
  ids: readonly string[],
): AvatarAccessory[] {
  return ids.flatMap((id) => {
    const found = style.accessories.find((one) => one.id === id);
    return found ? [found] : [];
  });
}

/** A look from `seed`, planned as one redraw of the house scene. */
export function planFresh(style: SokoBotAvatarStyle, seed: number): AvatarPlan {
  const look = lookFromSeed(style, seed);
  return {
    kind: "edit",
    look,
    note: "",
    prompt: freshLookPrompt(
      style,
      look,
      accessoriesOf(style, look.accessories),
    ),
  };
}

/**
 * The look with its rerollable scene details drawn again, never the person's
 * own choice (creature, coat, plant, accessory). Returns the axes that changed.
 */
export function rerollDetails(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
  seed: number,
): { look: AvatarLook; axes: string[] } {
  const random = seededRandom(seed);
  const traits = { ...look.traits };
  const axes: string[] = [];
  for (const axis of style.traits.filter((one) => one.rerollable)) {
    const option = axis.options[Math.floor(random() * axis.options.length)];
    if (option && option.id !== traits[axis.id]) {
      traits[axis.id] = option.id;
      axes.push(axis.id);
    }
  }
  return { look: { ...look, traits }, axes };
}

/**
 * What one change does to `base`. A typed change goes through the rewriter
 * first; an empty edit means a house rule refused it, and no image is bought.
 */
export async function planChange(
  style: SokoBotAvatarStyle,
  base: AvatarLook,
  change: AvatarChange,
): Promise<AvatarPlan> {
  const current = creatureOf(style, base.creature);
  switch (change.kind) {
    case "shuffle":
      return planFresh(style, randomSeed());
    case "creature": {
      const to = style.creatures.find((one) => one.id === change.creature);
      if (!to) throw unprocessableEntity("Unknown creature");
      if (to.id === base.creature) return { kind: "unchanged", note: "" };
      const coat = coatAfterSwap(style, base, to.id);
      const look: AvatarLook = {
        ...base,
        creature: to.id,
        // The creature is new, so earlier typed changes no longer apply. Its
        // coat is the one at the same place in its own list; the scene stays.
        typed: [],
        ...(base.traits && coat
          ? { traits: { ...base.traits, [COAT_TRAIT]: coat } }
          : {}),
      };
      return {
        kind: "edit",
        note: "",
        look,
        prompt: creatureSwapPrompt(
          style,
          current,
          coatPhrase(style, look),
          accessoriesOf(style, base.accessories),
        ),
      };
    }
    case "accessory": {
      const accessory = style.accessories.find(
        (one) => one.id === change.accessory,
      );
      if (!accessory) throw unprocessableEntity("Unknown accessory");
      const worn = base.accessories.includes(accessory.id);
      if (change.enabled === worn) return { kind: "unchanged", note: "" };
      return {
        kind: "edit",
        note: "",
        look: {
          ...base,
          accessories: change.enabled
            ? [...base.accessories, accessory.id]
            : base.accessories.filter((id) => id !== accessory.id),
        },
        prompt: change.enabled
          ? accessoryPrompt(style, current, accessory)
          : removeAccessoryPrompt(style, current, accessory),
      };
    }
    case "typed": {
      const rewritten = await avatarProvider().rewrite({
        rules: `${style.housePrompt}\n${style.rewriterRules}`,
        request: change.text,
      });
      const edit = rewritten.edit.trim();
      if (!edit) {
        return {
          kind: "unchanged",
          note:
            rewritten.note.trim() ||
            "That does not fit the avatar rules, so nothing changed.",
        };
      }
      return {
        kind: "edit",
        note: rewritten.note.trim(),
        look: {
          ...base,
          typed: [...base.typed, edit].slice(-MAX_TYPED_CHANGES),
        },
        prompt: edit,
      };
    }
  }
}

let houseScenes = new Map<string, Promise<Buffer>>();

/** The style's house look, bundled with Core (see `includeFiles` in vercel.json). */
export function loadHouseScene(style: SokoBotAvatarStyle): Promise<Buffer> {
  let scene = houseScenes.get(style.houseScene);
  if (!scene) {
    const file = `assets/soko-bot-avatar/${style.houseScene}`;
    // Bundled, the module sits in `dist/`; from source it sits three levels
    // below the package root.
    scene = readFile(new URL(`../${file}`, import.meta.url)).catch(() =>
      readFile(new URL(`../../../${file}`, import.meta.url)),
    );
    houseScenes.set(style.houseScene, scene);
    scene.catch(() => houseScenes.delete(style.houseScene));
  }
  return scene;
}

/** Test seam: forget cached house scenes. */
export function resetHouseScenes(): void {
  houseScenes = new Map();
}

/** One edit under the house prompt, then levelled to the style's background. */
export async function drawStill(
  style: SokoBotAvatarStyle,
  input: {
    prompt: string;
    reference: Buffer;
    target: number;
  },
): Promise<Buffer> {
  const edited = await avatarProvider().editImage({
    system: style.housePrompt,
    prompt: input.prompt,
    reference: input.reference,
  });
  return await levelStill(edited, input.target);
}

/** Copy bytes into the blob store under a content-hashed name. Returns the public URL. */
export async function storeAvatarAsset(
  buffer: Buffer,
  key: string,
): Promise<string> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const blob = await put(buildSokoBotAvatarBlobPathname(key, hash), buffer, {
    access: "public",
    contentType: "image/webp",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    // Bounded: an unbounded upload is the one step with no time limit, and a
    // hung one would outlive the lease or reservation that covers it.
    abortSignal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
  });
  return blob.url;
}
