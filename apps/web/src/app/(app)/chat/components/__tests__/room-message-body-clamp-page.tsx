/** Offline layout fixture: real rows whose bodies run past the collapsed height. */
import type {
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { ChatMessageRow } from "@/app/chat/components/room-message-row";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

const SENDER: ChatRoomUserParticipant = {
  id: "user-1",
  name: "Writer",
  email: "writer@example.com",
  image: null,
  presence: "offline",
};

function numbered(count: number, line: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => line(index + 1)).join(
    "\n",
  );
}

/** Each runs well past 16 lines; tables and code blocks scroll sideways. */
export const CLAMP_BODIES = {
  paragraphs: numbered(40, (index) => `Paragraph ${index}\n`),
  table: `Results\n\n| # | Result |\n| - | - |\n${numbered(40, (index) => `| ${index} | Row ${index} |`)}`,
  code: `Script\n\n\`\`\`\n${numbered(40, (index) => `line ${index}`)}\n\`\`\``,
} as const;

function message(kind: keyof typeof CLAMP_BODIES): ChatRoomMessage {
  return {
    id: `msg-${kind}`,
    roomId: "room-1",
    parentMessageId: null,
    content: CLAMP_BODIES[kind],
    createdAt: new Date(Date.UTC(2026, 9, 1, 13, 28)),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: { type: "user", user: SENDER },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
  };
}

function ClampPage() {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats("h23")}
    >
      <TooltipProvider>
        {(Object.keys(CLAMP_BODIES) as (keyof typeof CLAMP_BODIES)[]).map(
          (kind) => (
            <div key={kind} data-row={kind}>
              <ChatMessageRow
                message={message(kind)}
                coworkersById={new Map()}
                coworkersBySlug={new Map()}
                onToggleReaction={() => {}}
              />
            </div>
          ),
        )}
      </TooltipProvider>
    </NextIntlClientProvider>
  );
}

export function renderClampPage() {
  const host = document.getElementById("fixture");
  if (!host) throw new Error("Missing clamp fixture host");
  createRoot(host).render(<ClampPage />);
}
