import {
  renderWritingSkill,
  SOKO_BOT_SKILLS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  WRITING_SKILLS,
} from "@sokosumi/soko-bot";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/** One writing skill in full: how to write a network or kind of piece. */
export function readWritingSkill(id: string) {
  const skill = WRITING_SKILLS.find((candidate) => candidate.id === id);
  if (!skill) return null;
  return {
    skill: skill.id,
    name: skill.name,
    content: renderWritingSkill(skill),
  };
}

/**
 * read_skill: one of the turn's version skills in full, or for Cuso a
 * writing skill, for versions whose prompt carries only a skill index.
 */
export async function readSkill(
  authorized: AuthorizedSokoBotRuntime,
  input: unknown,
) {
  const { skill: id } = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_skill.parse(input);
  const version = await resolveSokoBotVersion(authorized.turn.versionId);
  if (version.skills.includes(id)) {
    const skill = SOKO_BOT_SKILLS.find((candidate) => candidate.id === id);
    if (skill)
      return { skill: skill.id, name: skill.name, content: skill.content };
  }
  const writing = version.profile === "cmo" ? readWritingSkill(id) : null;
  if (writing) return writing;
  throw new SokoBotRuntimeValidationError(
    `No skill "${id}". Your skills: ${version.skills.join(", ")}.`,
  );
}
