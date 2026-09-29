import type { SokoBotVersion } from "./types.js";
import { v17 } from "./v17.js";

/**
 * v17 with the Social-posts skill covering every connected provider.
 *
 * The skill said scheduling and publishing support X only, which stopped
 * being true once Core learned per-provider publishing (X, LinkedIn,
 * Facebook, Instagram, TikTok, YouTube). The skill now states each
 * provider's media and text requirements; the write tools themselves did
 * not change.
 */
export const v18: SokoBotVersion = {
  ...v17,
  id: "v18",
  name: "v18 · Publishes to every social provider",
  createdAt: "2026-09-29",
  summary:
    "v17 with the Social-posts skill covering every connected provider: the account's platform decides the media and text requirements, and scheduling and publishing are no longer X-only.",
  skills: v17.skills.map((id) =>
    id === "social-posts-x-only" ? "social-posts" : id,
  ),
  systemPrompt: v17.systemPrompt,
};
