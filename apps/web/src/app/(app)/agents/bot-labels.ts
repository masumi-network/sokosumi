import type { getTranslations } from "next-intl/server";

import type { DirectoryBot } from "./soko-bot-directory";

type Translate = Awaited<
  ReturnType<typeof getTranslations<"App.Agents.Directory">>
>;

export function botName(bot: DirectoryBot, t: Translate): string {
  return bot.name?.trim() || t("botFallbackName");
}

/** "Yours", "Alice's", "Team", or the Project it works on. */
export function botOwnerLabel(bot: DirectoryBot, t: Translate): string {
  switch (bot.owner.kind) {
    case "you":
      return t("ownerYou");
    case "person":
      return t("ownerPerson", { name: bot.owner.name });
    case "team":
      return t("ownerTeam");
    case "project":
      return bot.owner.name
        ? t("ownerProject", { project: bot.owner.name })
        : t("ownerProjectUnnamed");
  }
}

/** One line of what the bot is for. */
export function botPurpose(bot: DirectoryBot, t: Translate): string {
  switch (bot.owner.kind) {
    case "you":
    case "person":
      return t("purposePersonal");
    case "team":
      return t("purposeTeam");
    case "project":
      return t("purposeProject");
  }
}

export function botStatusLabel(bot: DirectoryBot, t: Translate): string {
  return t(`status.${bot.status}`);
}

/** Who the bot belongs to, as an About row says it: "You", "Alice", "Team". */
export function botBelongsTo(bot: DirectoryBot, t: Translate): string {
  if (bot.owner.kind === "you") return t("ownerYouAbout");
  if (bot.owner.kind === "person") return bot.owner.name;
  return botOwnerLabel(bot, t);
}
