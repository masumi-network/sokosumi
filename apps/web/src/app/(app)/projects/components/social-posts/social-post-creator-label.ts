import type { SocialPostCreator } from "@sokosumi/core-client";

/** Named humans are just the name. Coworker and Soko Bot keep their kind. */
export function socialPostCreatorLabel(
  creator: SocialPostCreator,
  kindLabel: string,
): string {
  if (creator.kind === "user" && creator.name) return creator.name;
  return creator.name ? `${kindLabel} · ${creator.name}` : kindLabel;
}
