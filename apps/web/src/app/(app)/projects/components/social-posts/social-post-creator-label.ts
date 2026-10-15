import type { SocialPostCreator } from "@sokosumi/core-client";

/** Named humans are just the name. Coworker and Soko Bot keep their kind. */
export function socialPostCreatorLabel(
  creator: SocialPostCreator,
  kindLabel: string,
): string {
  const name = creator.name?.trim();
  if (!name) return kindLabel;
  return creator.kind === "user" ? name : `${kindLabel} · ${name}`;
}
