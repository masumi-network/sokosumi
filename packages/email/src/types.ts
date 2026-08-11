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
