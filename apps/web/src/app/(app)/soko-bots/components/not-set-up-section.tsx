import type { SokoBotTeam } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";

import { PersonAvatar } from "@/app/contacts/components/contact-visuals";
import {
  AgentsSection,
  AgentsSectionLink,
} from "@/components/agents/directory/agents-page";
import { AGENTS_CARD_CLASS } from "@/components/agents/directory/agents-page-classes";
import { cn } from "@/lib/utils";

type Member = SokoBotTeam["members"][number];

/** Where owners and admins make an invite link. */
const INVITE_LINKS_HREF = "/organization#invite-links";

/**
 * Teammates who have no Soko Bot yet, and the invite link for owners and
 * admins. An organization of one gets only the invite.
 */
export async function NotSetUpSection({
  others,
  canInvite,
}: {
  /** Everyone in the organization but the viewer. */
  others: Member[];
  canInvite: boolean;
}) {
  const t = await getTranslations("App.SokoBots");
  const notSetUp = others.filter((member) => !member.bot);
  if (others.length > 0 && notSetUp.length === 0) return null;

  return (
    <AgentsSection
      id="soko-bots-not-set-up"
      title={t("notSetUpTitle")}
      note={others.length > 0 ? t("notSetUpNote") : undefined}
      action={
        canInvite ? (
          <AgentsSectionLink href={INVITE_LINKS_HREF}>
            {t("invitePeople")}
          </AgentsSectionLink>
        ) : null
      }
    >
      {notSetUp.length > 0 ? (
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          {notSetUp.map((member) => (
            <li
              key={member.userId}
              className={cn(
                AGENTS_CARD_CLASS,
                "flex min-w-0 items-center gap-3",
              )}
            >
              <PersonAvatar person={member} className="size-8" />
              <span className="text-foreground truncate text-sm font-medium">
                {member.name}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-2 py-6 text-center text-sm">
          {t("teamEmpty")}
        </p>
      )}
    </AgentsSection>
  );
}
