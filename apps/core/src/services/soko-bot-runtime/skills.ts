import {
  installSkill as installExternalSkill,
  listInstalledSkills,
  removeInstalledSkill,
  SokoBotSkillError,
  searchSkillsSh,
} from "@/services/soko-bot-skills.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";
import { actingMemberOf, requireOwnerSkillRequest } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

export async function listSkills(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { query?: string },
) {
  const userId = actingMemberOf(authorized);
  const [installed, catalog] = await Promise.all([
    listInstalledSkills(userId, authorized.turn.workspaceId),
    input.query ? searchSkillsSh(input.query).catch(() => null) : [],
  ]);
  return {
    installed: installed.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.slug,
    })),
    ...(input.query
      ? catalog === null
        ? { catalogUnavailable: true }
        : { catalog }
      : {}),
  };
}

export async function installSkill(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { source: string; skillName?: string },
  toolCallId: string,
) {
  const userId = requireOwnerSkillRequest(authorized);
  try {
    const result = await installExternalSkill({
      userId,
      workspaceId: authorized.turn.workspaceId,
      source: input.source,
      skillName: input.skillName ?? null,
    });
    return result.skill
      ? await runtime.commitReceipt(authorized, toolCallId, result.skill.id, {
          installed: {
            id: result.skill.id,
            name: result.skill.name,
            description: result.skill.description,
          },
        })
      : {
          installed: null,
          chooseOne: result.candidates.map((candidate) => ({
            skillName: candidate.name,
            description: candidate.description,
          })),
        };
  } catch (error) {
    if (error instanceof SokoBotSkillError)
      throw new SokoBotRefusedUnsentError(error.message);
    throw error;
  }
}

export async function removeSkill(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { skill: string },
  toolCallId: string,
) {
  const userId = requireOwnerSkillRequest(authorized);
  const installed = await listInstalledSkills(
    userId,
    authorized.turn.workspaceId,
  );
  const wanted = input.skill.toLowerCase();
  const skill = installed.find(
    (entry) => entry.id === input.skill || entry.name.toLowerCase() === wanted,
  );
  if (!skill)
    throw new SokoBotRefusedUnsentError(
      "No installed skill by that id or name; list_skills shows them",
    );
  await removeInstalledSkill(userId, skill.id);
  return runtime.commitReceipt(authorized, toolCallId, skill.id, {
    removed: { id: skill.id, name: skill.name },
  });
}
