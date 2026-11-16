// The Studio page remounts when its project changes. When someone picks or
// creates a project from the All-projects studio, the brief they typed there
// moves to that project, and only to that project.

let readWorkspaceBrief: (() => string) | null = null;
let handoff: { projectId: string; brief: string } | null = null;

/** The All-projects studio, while mounted, lends its brief to a project choice. */
export function registerStudioWorkspaceBrief(read: () => string) {
  readWorkspaceBrief = read;
  return () => {
    if (readWorkspaceBrief === read) readWorkspaceBrief = null;
  };
}

/** A project was chosen from the All-projects studio: its brief goes there. */
export function handStudioBriefTo(projectId: string) {
  const brief = readWorkspaceBrief?.() ?? "";
  handoff = brief.trim() ? { projectId, brief } : null;
}

/**
 * The brief handed to this project, once. Any studio mount ends a pending
 * handoff, so it never reaches another project or a later visit.
 */
export function takeStudioBriefFor(projectId: string | null): string | null {
  const brief = handoff?.projectId === projectId ? handoff.brief : null;
  handoff = null;
  return brief;
}
