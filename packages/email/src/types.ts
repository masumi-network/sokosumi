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
 * What every notification email needs.
 *
 * `actionUrl` is the same destination the in-app notification opens, so the
 * two surfaces cannot disagree about where the thing lives. The name is
 * optional because the account may not carry one, and each renderer greets
 * without it rather than greeting a blank.
 */
export interface NotificationEmailProps extends LocalizedEmailProps {
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

export interface ChatMentionEmailProps
  extends NotificationEmailProps,
    QuotedChatMessage {
  authorName?: null | string;
  roomName?: null | string;
}

export interface ChatDirectMessageEmailProps
  extends NotificationEmailProps,
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
export type TaskAttentionReason =
  | "approvalRequired"
  | "assigned"
  | "authenticationRequired"
  | "inputRequired"
  | "outOfCredits"
  | "scheduleRemovedByOperator";

interface TaskEmailProps extends NotificationEmailProps {
  /** Whoever the task is waiting on the reader for, or who finished it. */
  coworkerName?: null | string;
  projectName?: null | string;
  taskName?: null | string;
}

/** A task that stopped for the reader, the moment it stopped (SOK-1090). */
export interface TaskAttentionEmailProps extends TaskEmailProps {
  reason: TaskAttentionReason;
}

/** A task that finished (SOK-1090). */
export type TaskCompletedEmailProps = TaskEmailProps;

/**
 * Who is asking for a workspace: a vendor, or a coworker in early access.
 *
 * The two requests are the same email with one sentence changed, and the same
 * button, so they share a renderer rather than each bringing one.
 */
export type AccessRequestKind = "coworker" | "vendor";

/** Someone asked for access to a workspace the reader manages (SOK-1090). */
export interface AccessRequestEmailProps extends NotificationEmailProps {
  request: AccessRequestKind;
  requesterName?: null | string;
}

/** The reminders (SOK-916), a day after the emails above went unread. */
export type ChatMentionFollowUpEmailProps = ChatMentionEmailProps;

export type ChatDirectMessageFollowUpEmailProps = ChatDirectMessageEmailProps;

export interface TaskFollowUpEmailProps extends TaskEmailProps {
  reason?: null | TaskAttentionReason;
}
