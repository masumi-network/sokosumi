import {
  CMO_SHORT_FORM_DESCRIPTIONS,
  type CmoShortFormTool,
  cmoShortFormInputSchema,
} from "@sokosumi/soko-bot";
import { type ToolSet, tool } from "ai";

/**
 * The turn's tools with these save tools in their short form (cmo-v24): the
 * same call to Core, a one-line input and a short description. Core answers
 * a short-form call without saving.
 */
export function withShortForms(
  tools: ToolSet,
  shortForms: readonly CmoShortFormTool[],
): ToolSet {
  const offered: ToolSet = { ...tools };
  for (const name of shortForms) {
    const full = tools[name];
    if (!full?.execute) continue;
    offered[name] = tool({
      description: CMO_SHORT_FORM_DESCRIPTIONS[name],
      inputSchema: cmoShortFormInputSchema,
      execute: full.execute,
    });
  }
  return offered;
}

/** The short forms these tools still offer. */
export function shortFormsIn(
  tools: ToolSet,
  shortForms: readonly CmoShortFormTool[],
): CmoShortFormTool[] {
  return shortForms.filter((name) => name in tools);
}

/** Whether a step called one of these short forms. */
export function calledShortForm(
  steps: readonly { toolCalls: readonly { toolName: string }[] }[],
  shortForms: readonly CmoShortFormTool[],
): boolean {
  return steps.some((step) =>
    step.toolCalls.some((call) =>
      (shortForms as readonly string[]).includes(call.toolName),
    ),
  );
}

/** Ends the round on a short-form call, so the next one offers the full tool. */
export function endedByShortForm(shortForms: readonly CmoShortFormTool[]) {
  return ({
    steps,
  }: {
    steps: readonly { toolCalls: readonly { toolName: string }[] }[];
  }): boolean => calledShortForm(steps.slice(-1), shortForms);
}
