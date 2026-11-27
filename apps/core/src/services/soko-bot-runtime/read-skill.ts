import {
  getSokoBotSkillForVersion,
  renderWritingSkill,
  SOKO_BOT_SKILLS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotReadsPlaybooks,
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

/** The reads that return a whole skill: trusted Core text, never cut. */
export const SKILL_READS: ReadonlySet<string> = new Set([
  "read_skill",
  "read_writing_skill",
]);

export function isSkillRead(capability: string): boolean {
  return SKILL_READS.has(capability);
}

/** A skill read replayed for a retried call: the whole skill again. */
export async function readSkillAgain(
  authorized: AuthorizedSokoBotRuntime,
  capability: string,
  input: unknown,
) {
  if (capability === "read_skill") return readSkill(authorized, input);
  const { skill: id } =
    SOKO_BOT_TOOL_INPUT_SCHEMAS.read_writing_skill.parse(input);
  const skill = readWritingSkill(id);
  if (!skill) throw new SokoBotRuntimeValidationError("No such writing skill.");
  return skill;
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
    const exists = SOKO_BOT_SKILLS.some((candidate) => candidate.id === id);
    if (exists) {
      const skill = getSokoBotSkillForVersion(id, version);
      return { skill: skill.id, name: skill.name, content: skill.content };
    }
  }
  // Cuso reads every writing skill; a Soko Bot with the playbooks (v39)
  // reads only those, never the per-network post skills.
  const writing =
    version.profile === "cmo" ||
    (sokoBotReadsPlaybooks(version.skills) &&
      WRITING_SKILLS.some(
        (skill) => skill.id === id && skill.group === "playbooks",
      ))
      ? readWritingSkill(id)
      : null;
  if (writing) return writing;
  throw new SokoBotRuntimeValidationError(
    `No skill "${id}". Your skills: ${version.skills.join(", ")}.`,
  );
}
