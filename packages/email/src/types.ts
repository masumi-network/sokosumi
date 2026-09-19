export interface RenderedEmail {
  html: string;
  subject: string;
}

export interface LocalizedEmailProps {
  locale?: string;
}

export interface VerificationEmailProps extends LocalizedEmailProps {
  name: string;
  verificationLink: string;
}

export interface ResetPasswordEmailProps extends LocalizedEmailProps {
  name: string;
  resetLink: string;
}

export interface MagicLinkEmailProps extends LocalizedEmailProps {
  magicLink: string;
  name?: string;
}

export interface OrganizationInvitationEmailProps extends LocalizedEmailProps {
  invitationLink: string;
  invitorUsername: string;
  organizationName: string;
}

export interface ChatRoomInvitationEmailProps extends LocalizedEmailProps {
  invitationLink: string;
  invitorUsername: string;
  organizationName: string;
  channelName: string;
}

export interface JobFailureNotificationEmailProps extends LocalizedEmailProps {
  agentBlockchainIdentifier: string;
  agentId: string;
  agentName: string;
  agentStatus: null | string;
  jobBlockchainIdentifier: null | string;
  jobId: string;
  network: string;
  onChainStatus: null | string;
  result: null | string;
  resultHash: null | string;
}

/**
 * What every reminder email needs (SOK-916).
 *
 * `actionUrl` is the same destination the in-app reminder opens, so the two
 * surfaces cannot disagree about where the thing lives. The name is optional
 * because the account may not carry one, and each renderer greets without it
 * rather than greeting a blank.
 */
export interface NotificationFollowUpEmailProps extends LocalizedEmailProps {
  actionUrl: string;
  recipientName?: null | string;
}

/**
 * The message itself, as the notification stored it.
 *
 * Core keeps a preview on the chat notification row and takes it back when the
 * message is edited or deleted, so this is what the reader's Notification
 * Center says too. Absent when there is nothing to show: a deleted message, or
 * a body that cleans to nothing once an unnamed mention is taken out of it.
 */
interface QuotedChatMessage {
  messagePreview?: null | string;
}

export interface ChatMentionFollowUpEmailProps
  extends NotificationFollowUpEmailProps,
    QuotedChatMessage {
  authorName?: null | string;
  roomName?: null | string;
}

export interface ChatDirectMessageFollowUpEmailProps
  extends NotificationFollowUpEmailProps,
    QuotedChatMessage {
  authorName?: null | string;
}

/**
 * Why a task is waiting, in the words of the notification that said so.
 *
 * The same six keys Core calls task attention. A union rather than a string,
 * because each one names a sentence in the catalogs and a key with no sentence
 * must not be able to reach them.
 */
export type TaskFollowUpReason =
  | "approvalRequired"
  | "assigned"
  | "authenticationRequired"
  | "inputRequired"
  | "outOfCredits"
  | "scheduleRemovedByOperator";

export interface TaskFollowUpEmailProps extends NotificationFollowUpEmailProps {
  /** Whoever the task is waiting on the reader for. */
  coworkerName?: null | string;
  projectName?: null | string;
  reason?: null | TaskFollowUpReason;
  taskName?: null | string;
}
