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

export interface JobFinalStatusEmailProps extends LocalizedEmailProps {
  agentName: string;
  jobLink: string;
  jobName?: null | string;
  jobStatus: string;
  recipientName: string;
}

export interface JobInputRequiredEmailProps extends LocalizedEmailProps {
  agentName: string;
  jobLink: string;
  jobName?: null | string;
  recipientName: string;
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

export interface ChatMentionFollowUpEmailProps
  extends NotificationFollowUpEmailProps {
  authorName?: null | string;
  roomName?: null | string;
}

export interface ChatDirectMessageFollowUpEmailProps
  extends NotificationFollowUpEmailProps {
  authorName?: null | string;
}

export interface TaskFollowUpEmailProps extends NotificationFollowUpEmailProps {
  taskName?: null | string;
}

export interface JobFollowUpEmailProps extends NotificationFollowUpEmailProps {
  jobName?: null | string;
}
