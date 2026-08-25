import { sokoBotRuntimeSkillsSchema } from "@sokosumi/soko-bot";
import { defineDynamic, defineSkill } from "eve/skills";

import { readRuntimeAuth } from "../lib/auth";
import { callCore } from "../lib/core";

/**
 * Skills the owner installed from skills.sh / GitHub. Resolved once per
 * session (sessions are per turn) and advertised to the model like any
 * authored skill: description up front, body via `load_skill`.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const auth = readRuntimeAuth(
        ctx.session.auth.current ?? ctx.session.auth.initiator,
      );
      const { skills } = await callCore(
        "/v1/internal/soko-bot/skills",
        auth,
        ctx.session.id,
        {},
        sokoBotRuntimeSkillsSchema,
      );
      const map: Record<string, ReturnType<typeof defineSkill>> = {};
      for (const skill of skills) {
        map[skill.name] = defineSkill({
          description:
            skill.description || `Instructions for the ${skill.name} skill.`,
          markdown: skill.markdown,
        });
      }
      return map;
    },
  },
});
