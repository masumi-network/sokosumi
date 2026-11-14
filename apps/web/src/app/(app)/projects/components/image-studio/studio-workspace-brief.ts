// The Studio page remounts when the project selector switches scope, so a brief
// typed before any project was picked would be lost with the old instance.
let workspaceBrief: string | null = null;

/** Keep the brief the All-projects studio held when it unmounted. */
export function keepStudioWorkspaceBrief(brief: string) {
  workspaceBrief = brief.trim() ? brief : null;
}

/** Hand the kept brief to the next studio, once. */
export function takeStudioWorkspaceBrief(): string | null {
  const brief = workspaceBrief;
  workspaceBrief = null;
  return brief;
}
