import { composeSystemPrompt } from "@sokosumi/soko-bot";
import { loadSokoBotPersona } from "@/helpers/soko-bot-owner";
import prisma from "@/lib/db/prisma";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import {
  type RuntimeAuthorizationInput,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

/** Owner-installed skills, advertised by Eve as load-on-demand skills. */
export async function getInstalledSkills(
  runtime: RuntimeOperations,
  input: RuntimeAuthorizationInput,
) {
  const authorized = await runtime.authorize(input);
  const skills = await prisma.sokoBotInstalledSkill.findMany({
    where: { sokoBotId: authorized.turn.sokoBotId },
    orderBy: { createdAt: "asc" },
    select: { name: true, description: true, markdown: true },
  });
  return { skills };
}

export async function getContext(
  runtime: RuntimeOperations,
  input: RuntimeAuthorizationInput,
) {
  const authorized = await runtime.authorize(input);
  const snapshot = await prisma.sokoBotContextSnapshot.findFirst({
    where: {
      id: authorized.grant.contextSnapshotId,
      turnId: authorized.turn.id,
    },
    select: {
      packet: true,
      hash: true,
      schemaVersion: true,
      generatedAt: true,
    },
  });
  if (!snapshot) {
    throw new SokoBotRuntimeAuthorizationError(
      "Context snapshot is unavailable",
    );
  }
  const version = await resolveSokoBotVersion(authorized.turn.versionId);
  const persona = await loadSokoBotPersona(authorized.turn.sokoBotId);
  return {
    ...snapshot,
    version: {
      id: version.id,
      name: version.name,
      model: version.model,
      systemPrompt: composeSystemPrompt(version, persona),
      skills: [...version.skills],
    },
  };
}
