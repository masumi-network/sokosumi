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

/** Same destination the in-app notification opens. Name optional. */
export interface NotificationEmailProps extends LocalizedEmailProps {
  actionUrl: string;
  recipientName?: null | string;
}

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

/** Catalog keys for task attention; unknown keys must not reach the catalogs. */
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

/** Catalog keys for task updates, plus `updated` as the fallback for unknown keys. */
export type TaskUpdateReason =
  | "failed"
  | "canceled"
  | "scheduleRepaired"
  | "scheduleRemovedByOperator"
  | "scheduleUpdatedByMember"
  | "scheduleRemovedByMember"
  | "scheduleSourceChangedByMember"
  | "scheduleOccurrenceChangedByMember"
  | "updated";

/** A task changed without asking anything of the reader (SOK-1090, SOK-1142). */
export interface TaskUpdateEmailProps extends TaskEmailProps {
  reason: TaskUpdateReason;
}

export interface ProjectUpdateEmailProps extends NotificationEmailProps {
  projectName?: null | string;
  outcome: "closed" | "closeFailed";
}

/** A task that finished (SOK-1090). */
export type TaskCompletedEmailProps = TaskEmailProps;

/**
 * Unread messages wait in a room the reader is in (SOK-1142).
 *
 * One unread message is shown the way a mention is: who wrote, and what they
 * wrote. Several are counted instead, because no one of them speaks for the
 * rest. `unreadCount` is how many the email stands for at the moment it is
 * handed to the sender, so an email that is rescheduled is rendered again.
 */
export interface ChatRoomMessageEmailProps extends NotificationEmailProps {
  authorName?: null | string;
  messagePreview?: null | string;
  roomName?: null | string;
  unreadCount?: null | number;
}

export type AccessRequestKind = "coworker" | "vendor";

/** Someone asked for access to a workspace the reader manages (SOK-1090). */
export interface AccessRequestEmailProps extends NotificationEmailProps {
  request: AccessRequestKind;
  requesterName?: null | string;
}

/**
 * How many rows a chat reminder speaks for, when it speaks for more than the
 * one it was written from.
 *
 * The reminder is one per room per day, so it can stand for several unread
 * rows. One of them is shown the way the event email showed it: who wrote,
 * and what they wrote. Several are counted instead, because no one of them
 * speaks for the rest (SOK-1142).
 */
interface ChatFollowUpCount {
  unreadCount?: null | number;
}

/** The reminders (SOK-916), a day after the emails above went unread. */
export interface ChatMentionFollowUpEmailProps
  extends ChatMentionEmailProps,
    ChatFollowUpCount {}

export interface ChatDirectMessageFollowUpEmailProps
  extends ChatDirectMessageEmailProps,
    ChatFollowUpCount {}

export interface TaskFollowUpEmailProps extends TaskEmailProps {
  reason?: null | TaskAttentionReason;
}

/** A wallet that ran low. Stripe has no email for Sokosumi credits. */
export interface BillingLowBalanceEmailProps extends NotificationEmailProps {
  credits: number;
}

/** Payment failures stay in-app; Stripe already mailed those. */
export type BillingFollowUpReason = "lowBalance";

export interface BillingFollowUpEmailProps extends NotificationEmailProps {
  /** What was left when the balance ran low; only that reason reads it. */
  credits?: null | number;
  reason?: null | BillingFollowUpReason;
}
