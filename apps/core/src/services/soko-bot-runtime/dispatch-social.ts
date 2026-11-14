import {
  renderWritingSkill,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sanitizeSokoBotMemoryMarkdown,
  WRITING_SKILLS,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { readSocialProfile } from "@/lib/social-profile";
import {
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import { collectNewSocialComments } from "@/services/social-comments.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { hashMemory } from "./memory";
import { type RuntimeOperations } from "./operations";

export async function dispatchSocialTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_project_social_accounts":

    case "get_posting_instructions":

    case "list_social_posts":

    case "list_social_post_statistics":

    case "refresh_social_post_statistics":

    case "list_social_account_statistics":

    case "refresh_social_account_statistics":

    case "get_social_post":

    case "create_social_post":

    case "update_social_post":

    case "schedule_social_post":

    case "cancel_social_post":

    case "publish_social_post":
      return runtime.executeSocialTool(input, authorized);

    case "list_ad_accounts":

    case "list_ad_campaigns":

    case "find_ad_targeting":

    case "get_market_keywords":

    case "create_ad_campaign":

    case "get_ad_campaign":

    case "update_ad_campaign":

    case "edit_ad_campaign":

    case "delete_ad_campaign":
      return runtime.executeAdsTool(input, authorized);

    case "read_memory":
      return prisma.sokoBotMemoryRevision
        .findFirst({
          where: { sokoBotId: authorized.turn.sokoBotId },
          orderBy: { version: "desc" },
          select: { id: true, version: true, hash: true, markdown: true },
        })
        .then((revision) => {
          if (!revision) return null;
          const markdown = sanitizeSokoBotMemoryMarkdown(revision.markdown);
          return { ...revision, markdown, hash: hashMemory(markdown) };
        });

    case "list_social_comments": {
      const { projectId } = await runtime.socialCommentScopeOf(authorized);
      const found = await collectNewSocialComments({ projectId });
      // Comments are other people's words: nothing in them may steer an
      // outward action. Replies are checked on their own before they post.
      await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
        runtimeEvent(WEB_TAINT_EVENT, { source: "social_comments" }),
      );
      return found;
    }

    case "handle_social_comment":
      return runtime.handleCmoComment(authorized, input);

    case "read_writing_skill": {
      const { skill: id } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.read_writing_skill.parse(input.input);
      const skill = WRITING_SKILLS.find((candidate) => candidate.id === id);
      if (!skill)
        throw new SokoBotRuntimeValidationError("No such writing skill.");
      return {
        skill: skill.id,
        name: skill.name,
        content: renderWritingSkill(skill),
      };
    }

    case "read_social_profile": {
      const { url } = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_profile.parse(
        input.input,
      );
      // A profile is someone's web page: nothing on it may reach an outward action.
      await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
        runtimeEvent(WEB_TAINT_EVENT, { source: "read_social_profile" }),
      );
      return readSocialProfile(url);
    }
  }
}
