import type { SokoBot } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

const PA_ASSIGNEE_KEY_PREFIX = "orchestrator:";
const EMPTY_VENDOR_LOGOS = { light: null, dark: null } as const;

/** Builds a picker row for the signed-in user's PA (orchestrator assignee rail). */
export function buildPaAssigneeOption(
  bot: SokoBot | null | undefined,
): CoworkerOption | null {
  if (!bot) return null;

  const displayName = bot.name?.trim() || "Assistant";

  return {
    id: `${PA_ASSIGNEE_KEY_PREFIX}${bot.id}`,
    slug: "assistant",
    name: displayName,
    image: bot.avatarImageUrl ?? "",
    caption: "Personal Assistant",
    vendor: {
      id: "sokosumi",
      name: "Sokosumi",
      slug: "sokosumi",
      logos: EMPTY_VENDOR_LOGOS,
    },
    priority: Number.MAX_SAFE_INTEGER,
  };
}

export function isPaAssigneePickerId(id: string): boolean {
  return id.startsWith(PA_ASSIGNEE_KEY_PREFIX);
}

export function parsePaAssigneeOrchestratorId(id: string): string | null {
  if (!isPaAssigneePickerId(id)) return null;
  return id.slice(PA_ASSIGNEE_KEY_PREFIX.length) || null;
}

export function toPaAssigneePickerId(orchestratorId: string): string {
  return `${PA_ASSIGNEE_KEY_PREFIX}${orchestratorId}`;
}

export function mergeAssigneePickerOptions(
  coworkerOptions: CoworkerOption[],
  paOption: CoworkerOption | null,
): CoworkerOption[] {
  if (!paOption) return coworkerOptions;
  return [paOption, ...coworkerOptions];
}

export function resolveAssigneeWriteFields(selectedPickerId: string): {
  assigneeId: string | null;
  assigneeOrchestratorId: string | null;
} {
  const orchestratorId = parsePaAssigneeOrchestratorId(selectedPickerId);
  if (orchestratorId) {
    return { assigneeId: null, assigneeOrchestratorId: orchestratorId };
  }
  return {
    assigneeId: selectedPickerId.trim() ? selectedPickerId : null,
    assigneeOrchestratorId: null,
  };
}

export function initialAssigneePickerId(input: {
  assigneeId?: string | null;
  assigneeOrchestratorId?: string | null;
}): string {
  if (input.assigneeOrchestratorId) {
    return toPaAssigneePickerId(input.assigneeOrchestratorId);
  }
  return input.assigneeId ?? "";
}
