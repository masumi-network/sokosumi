import type { SokoBotTeam } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";

import { PersonAvatar } from "@/app/contacts/components/contact-visuals";
import { AgentsSectionLink } from "@/components/agents/directory/agents-page";

type Member = SokoBotTeam["members"][number];

/** Where owners and admins make an invite link. */
const INVITE_LINKS_HREF = "/organization#invite-links";

/**
 * One line at the end of the Soko Bots section: teammates without a bot, and
 * the invite link for owners and admins. An organization of one gets only
 * the invite.
 */
export async function NotSetUpLine({
  others,
  canInvite,
}: {
  /** Everyone in the organization but the viewer. */
  others: Member[];
  canInvite: boolean;
}) {
  const t = await getTranslations("App.SokoBots");
  const notSetUp = others.filter((member) => !member.bot);
  if (notSetUp.length === 0 && (others.length > 0 || !canInvite)) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pt-1">
      <span className="text-muted-foreground text-xs font-medium">
        {notSetUp.length > 0 ? t("notSetUpTitle") : t("teamEmpty")}
      </span>
      {notSetUp.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5">
          {notSetUp.map((member) => (
            <li
              key={member.userId}
              className="border-border bg-background text-foreground flex items-center gap-1.5 rounded-full border py-0.5 ps-0.5 pe-2.5 text-xs"
            >
              <PersonAvatar person={member} className="size-5" />
              {member.name}
            </li>
          ))}
        </ul>
      ) : null}
      {canInvite ? (
        <AgentsSectionLink href={INVITE_LINKS_HREF}>
          {t("invitePeople")}
        </AgentsSectionLink>
      ) : null}
    </div>
  );
}
