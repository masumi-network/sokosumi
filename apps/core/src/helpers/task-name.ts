import { removeDesignMdAttachmentLinks } from "@sokosumi/utils";

import { openrouterClient } from "@/clients/openrouter.client";

const TASK_FALLBACK_NAME_MAX_LENGTH = 60;
const UNTITLED_TASK_NAME = "Untitled Task";

function fallbackTaskName(source: string): string {
  const firstLine = source.split("\n").find((line) => line.trim());
  return (firstLine ?? "").trim().slice(0, TASK_FALLBACK_NAME_MAX_LENGTH);
}

export async function resolveTaskName(input: {
  name?: string | null;
  description?: string | null;
}): Promise<string> {
  const provided = input.name?.trim();
  if (provided) {
    return provided;
  }

  const namingSource = removeDesignMdAttachmentLinks(
    input.description ?? "",
  ).trim();
  if (!namingSource) {
    return UNTITLED_TASK_NAME;
  }

  const generated = (
    await openrouterClient.generateTaskName(namingSource)
  )?.trim();
  const candidate = generated || fallbackTaskName(namingSource);
  return candidate || UNTITLED_TASK_NAME;
}
