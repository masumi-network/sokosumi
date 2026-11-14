import prisma from "@/lib/db/prisma";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import {
  mailSendRefusal,
  ownerAskedToSend,
} from "@/lib/soko-bot/mail-send-guard";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  activeIntegrationsForBot,
  createInboxDraft,
  fetchInboxAttachment,
  fetchInboxMessage,
  INBOX_ATTACHMENT_MAX_BYTES,
  modifyInboxMessages,
  sendInboxDraft,
} from "@/services/soko-bot-integrations.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { driveFolderFor } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

/** The receipt for a write that already happened outside a transaction. */
export async function commitReceipt<T>(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  toolCallId: string,
  targetId: string,
  result: T,
): Promise<T> {
  await prisma.$transaction((tx) =>
    commitActionReceipt(tx, {
      turnId: authorized.turn.id,
      toolCallId,
      actorBotId: authorized.turn.sokoBotId,
      targetId,
      result: persistedToolResult(result),
    }),
  );
  return result;
}

export async function mailboxFor(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  provider: string | undefined,
) {
  const integrations = await activeIntegrationsForBot(
    authorized.turn.sokoBotId,
    "email",
    provider,
  );
  if (integrations.length === 0)
    throw new SokoBotRefusedUnsentError("No connected mailbox");
  if (integrations.length > 1)
    throw new SokoBotRefusedUnsentError(
      "Several mailboxes are connected; say which provider",
    );
  return integrations[0];
}

/** Marks mail read or unread, or archives it. */
export async function updateEmails(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    provider?: string;
    messageIds: string[];
    read?: boolean;
    archive?: boolean;
  },
  toolCallId: string,
) {
  if (input.read === undefined && !input.archive)
    throw new SokoBotRuntimeValidationError("Say read, unread or archive");
  const integration = await runtime.mailboxFor(authorized, input.provider);
  try {
    await modifyInboxMessages(integration, input.messageIds, input);
  } catch (error) {
    throw new SokoBotRuntimeValidationError(
      `The mailbox refused the change: ${error instanceof Error ? error.message : "unknown error"}. It may need reconnecting with write access.`,
    );
  }
  return runtime.commitReceipt(authorized, toolCallId, integration.id, {
    updated: input.messageIds.length,
    read: input.read,
    archived: Boolean(input.archive),
  });
}

/** Writes a draft in the owner's mailbox; nothing is sent. */
export async function draftEmail(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    provider?: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    replyToMessageId?: string;
  },
  toolCallId: string,
) {
  const integration = await runtime.mailboxFor(authorized, input.provider);
  const threadId = input.replyToMessageId
    ? ((await fetchInboxMessage(integration, input.replyToMessageId))
        .threadId ?? undefined)
    : undefined;
  const draftId = await createInboxDraft(integration, { ...input, threadId });
  await prisma.sokoBotMailDraft.create({
    data: {
      sokoBotId: authorized.turn.sokoBotId,
      provider: integration.provider.id,
      draftId,
      to: input.to,
      subject: input.subject,
      turnId: authorized.turn.id,
    },
  });
  return runtime.commitReceipt(authorized, toolCallId, draftId, {
    draftId,
    to: input.to,
    subject: input.subject,
    sent: false,
    note: "Show your owner the draft. Send it only when they explicitly say to in a later message.",
  });
}

/**
 * Sends a draft this bot wrote, only when its owner, in their own chat,
 * saw it in an earlier turn and now explicitly says to send it.
 */
export async function sendEmailDraft(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { draftId: string },
  toolCallId: string,
) {
  const refusal = mailSendRefusal({
    source: authorized.turn.source,
    chainDepth: authorized.turn.chainDepth,
    askedByAssistant: authorized.askedByKind === "ASSISTANT",
    shared: Boolean(authorized.reader.sharedScope),
  });
  if (refusal) throw new SokoBotRefusedUnsentError(refusal);
  const draft = await prisma.sokoBotMailDraft.findUnique({
    where: {
      sokoBotId_draftId: {
        sokoBotId: authorized.turn.sokoBotId,
        draftId: input.draftId,
      },
    },
  });
  if (!draft)
    throw new SokoBotRefusedUnsentError("Only drafts you wrote can be sent");
  if (draft.sentAt)
    throw new SokoBotRefusedUnsentError("This draft was already sent");
  if (draft.turnId === authorized.turn.id)
    throw new SokoBotRefusedUnsentError(
      "Show your owner the draft first; send it after they say so in a new message",
    );
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { userMessage: true },
  });
  if (!(await ownerAskedToSend(turn.userMessage, draft)))
    throw new SokoBotRefusedUnsentError(
      "Your owner has not explicitly said to send this draft. Ask them.",
    );
  const [integration] = await activeIntegrationsForBot(
    authorized.turn.sokoBotId,
    "email",
    draft.provider,
  );
  if (!integration)
    throw new SokoBotRefusedUnsentError("The mailbox is no longer connected");
  await sendInboxDraft(integration, draft.draftId);
  await prisma.sokoBotMailDraft.update({
    where: { id: draft.id },
    data: { sentAt: new Date(), sentByTurnId: authorized.turn.id },
  });
  return runtime.commitReceipt(authorized, toolCallId, draft.draftId, {
    sent: true,
    to: draft.to,
    subject: draft.subject,
  });
}

/** Saves one mail attachment into the owner's Files. */
export async function saveEmailAttachment(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    provider?: string;
    messageId: string;
    attachmentId: string;
    filename: string;
    folder?: string;
    saveAs?: string;
  },
  toolCallId: string,
) {
  const folder = driveFolderFor(input.folder);
  const integration = await runtime.mailboxFor(authorized, input.provider);
  if (!integration.provider.tools.getAttachment)
    throw new SokoBotRefusedUnsentError(
      `${integration.provider.name} attachments cannot be saved yet`,
    );
  // Gmail hands out a new attachment id on every read, so a name match on
  // a fresh read stands in for an id from an earlier one.
  const message = await fetchInboxMessage(integration, input.messageId);
  const attachment =
    message.attachments.find((item) => item.id === input.attachmentId) ??
    message.attachments.find((item) => item.filename === input.filename);
  if (!attachment)
    throw new SokoBotRefusedUnsentError(
      `That email has no attachment "${input.filename}"; read_email lists its attachments`,
    );
  if (attachment.size && attachment.size > INBOX_ATTACHMENT_MAX_BYTES)
    throw new SokoBotRefusedUnsentError("That attachment is larger than 25 MB");
  const saved = await runtime.saveFileBytes(authorized, {
    filename: input.saveAs ?? attachment.filename,
    folder,
    contentType: attachment.mimeType,
    read: async () => {
      const bytes = await fetchInboxAttachment(integration, {
        messageId: input.messageId,
        attachmentId: attachment.id,
        filename: attachment.filename,
      });
      if (bytes.byteLength > INBOX_ATTACHMENT_MAX_BYTES)
        throw new SokoBotRefusedUnsentError(
          "That attachment is larger than 25 MB",
        );
      return bytes;
    },
  });
  return runtime.commitReceipt(
    authorized,
    toolCallId,
    saved.id ?? `${input.messageId}:${attachment.id}`,
    saved,
  );
}
