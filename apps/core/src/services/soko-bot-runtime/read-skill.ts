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
    const skill = SOKO_BOT_SKILLS.find((candidate) => candidate.id === id);
    if (skill)
      return { skill: skill.id, name: skill.name, content: skill.content };
  }
  const writing = version.profile === "cmo" ? readWritingSkill(id) : null;
  if (writing) return writing;
  const writingIds =
    version.profile === "cmo" ? WRITING_SKILLS.map((skill) => skill.id) : [];
  const closest = closestSkillIds(id, [...version.skills, ...writingIds]);
  throw new SokoBotRuntimeValidationError(
    `No skill "${id}". ${closest.length ? `Closest: ${closest.join(", ")}. ` : ""}Your skills: ${version.skills.join(", ")}.${writingIds.length ? ` Writing skills, read the same way: ${writingIds.join(", ")}.` : ""}`,
  );
}

/** Known ids that share a word with an unknown one, such as `launch`. */
function closestSkillIds(id: string, known: readonly string[]): string[] {
  const words = new Set(
    id
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && word !== "cmo"),
  );
  return known
    .filter((candidate) => candidate.split("-").some((word) => words.has(word)))
    .slice(0, 3);
}
