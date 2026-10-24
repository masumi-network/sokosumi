"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth/auth.client";
import { ChatPreferenceSwitch } from "./chat-preference-switch";

interface ChatDisplayPreferencesProps {
  showRoomUnreadCount: boolean;
  tagDirectMessages: boolean;
}

async function updateUser(
  fields: Parameters<typeof authClient.updateUser>[0],
): Promise<void> {
  const result = await authClient.updateUser(fields);
  if (result.error) {
    throw new Error(result.error.message ?? "update_failed");
  }
}

/**
 * Chat display preferences, as a recessive card nested in the notification card.
 *
 * It is a card and not a row of that card's grid, because the grid answers what
 * Sokosumi tells a reader about and where each of those things reaches them.
 * These preferences change no delivery at all: they change what the reader sees
 * in a sidebar they already have open, so a row of that grid would misreport
 * what they do.
 *
 * It reads quieter than its host on purpose. It keeps the host's ground so it
 * does not stand out as a second surface, and a border alone says where it
 * starts. One radius step down, tighter padding, and its heading dropped to
 * label size, so a reader meets the delivery grid first and finds this below
 * it.
 */
export function ChatDisplayPreferences({
  showRoomUnreadCount,
  tagDirectMessages,
}: ChatDisplayPreferencesProps) {
  const t = useTranslations("App.Account.ChatDisplay");
  const messages = { loading: t("loading"), error: t("error") };

  return (
    // `rounded-lg` is one step under the host card's `rounded-xl`. The two do
    // not share a corner (this sits 1.5rem inside), so there is no concentric
    // radius to preserve, only the hierarchy to state. Ground stays the host's:
    // a second fill made this read as a louder surface, not a quieter one. The
    // border does the whole job, and a boundary is structure, which a border
    // states and a shadow would not.
    <Card className="gap-2 rounded-lg py-4">
      {/* `gap-0`: `CardHeader` is a two-row grid and this header has one child,
          so the gutter would otherwise be drawn to an empty second row. */}
      <CardHeader className="gap-0 px-4">
        {/* h2: the notification card around this one owns the route's h1.
            Demoted by size and weight, never by colour: `text-muted-foreground`
            is a half-alpha near-black, which is 3.7:1 on card ground in light
            mode and fails AA for text this small.
            `leading-none` is restated because any `text-*` replaces it in the
            merge, and without it the title line box grows. */}
        <CardTitle className="text-xs leading-none font-medium">
          <h2>{t("title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        <ChatPreferenceSwitch
          title={t("roomUnreadCountTitle")}
          description={t("roomUnreadCountDescription")}
          initialValue={showRoomUnreadCount}
          // The switch says "show"; the stored field says "hide" (ADR-0038),
          // so that every reader's false means shown.
          save={(value) => updateUser({ hideRoomUnreadCount: !value })}
          messages={{
            ...messages,
            enabled: t("roomUnreadCountEnabledSuccess"),
            disabled: t("roomUnreadCountDisabledSuccess"),
          }}
        />
        <ChatPreferenceSwitch
          title={t("tagDirectMessagesTitle")}
          description={t("tagDirectMessagesDescription")}
          initialValue={tagDirectMessages}
          save={(value) => updateUser({ tagDirectMessages: value })}
          messages={{
            ...messages,
            enabled: t("tagDirectMessagesEnabledSuccess"),
            disabled: t("tagDirectMessagesDisabledSuccess"),
          }}
        />
      </CardContent>
    </Card>
  );
}
