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

export interface NotificationFollowUpEmailProps extends LocalizedEmailProps {
  actionUrl: string;
  recipientName?: null | string;
}

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

/** Catalog sentence keys; a string would let an unknown key fail to resolve. */
export type TaskFollowUpReason =
  | "approvalRequired"
  | "assigned"
  | "authenticationRequired"
  | "inputRequired"
  | "outOfCredits"
  | "scheduleRemovedByOperator";

export interface TaskFollowUpEmailProps extends NotificationFollowUpEmailProps {
  coworkerName?: null | string;
  projectName?: null | string;
  reason?: null | TaskFollowUpReason;
  taskName?: null | string;
}
