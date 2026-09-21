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

export type TaskUpdateReason =
  | "failed"
  | "canceled"
  | "scheduleRepaired"
  | "scheduleRemovedByOperator"
  | "scheduleUpdatedByMember"
  | "scheduleRemovedByMember"
  | "scheduleSourceChangedByMember"
  | "scheduleOccurrenceChangedByMember";

export interface TaskUpdateEmailProps extends TaskEmailProps {
  reason: TaskUpdateReason;
}

export interface ProjectUpdateEmailProps extends NotificationEmailProps {
  projectName?: null | string;
  outcome: "closed" | "closeFailed";
}

/** A task that finished (SOK-1090). */
export type TaskCompletedEmailProps = TaskEmailProps;

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
