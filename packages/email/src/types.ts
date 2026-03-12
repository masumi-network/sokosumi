export interface RenderedEmail {
  html: string;
  subject: string;
}

export interface VerificationEmailProps {
  name: string;
  verificationLink: string;
}

export interface ResetPasswordEmailProps {
  name: string;
  resetLink: string;
}

export interface MagicLinkEmailProps {
  magicLink: string;
  name?: string;
  token?: string;
}

export interface OrganizationInvitationEmailProps {
  invitationLink: string;
  invitorUsername: string;
  organizationName: string;
}

export interface JobFinalStatusEmailProps {
  agentName: string;
  jobLink: string;
  jobName?: null | string;
  jobStatus: string;
  recipientName: string;
}

export interface JobInputRequiredEmailProps {
  agentName: string;
  jobLink: string;
  jobName?: null | string;
  recipientName: string;
}

export interface JobFailureNotificationEmailProps {
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
