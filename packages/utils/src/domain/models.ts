import type {
  AgentJobStatus,
  AgentStatus,
  BlobStatus,
  JobType,
  NoticeKind,
  OnChainJobStatus,
  OnChainTransactionStatus,
  PaymentType,
  PricingType,
  RiskClassification,
} from "./enums.js";
import type { MemberRole } from "./member-role.js";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: string | null;
  createdAt: Date;
  stripeCustomerId: string | null;
}

export interface OrganizationWithLimitedInfo {
  id: string;
  name: string;
  slug: string;
}

export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: MemberRole | string;
  seatAssignedAt: Date | null;
  createdAt: Date;
}

export interface MemberWithOrganization extends Member {
  organization: Organization;
}

export interface Invitation {
  id: string;
  createdAt: Date;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
}

export interface Notice {
  id: string;
  kind: NoticeKind;
  bodyMarkdown: string;
  effectiveAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitValue {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  unit: string;
  amount: bigint;
  agentFixedPricingId: string | null;
  paymentRequestId: string | null;
  purchaseRequestId: string | null;
}

export interface AgentFixedPricing {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  amounts: UnitValue[];
}

export interface AgentPricing {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  pricingType: PricingType;
  fixedPricing: AgentFixedPricing | null;
  agentFixedPricingId: string | null;
}

export interface ExampleOutput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  mimeType: string;
  url: string;
  agentId: string | null;
  agentIdOverride: string | null;
}

export interface Tag {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
}

export interface Category {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  icon: string | null;
  priority: number;
  styles: string | null;
}

export interface UserAgentRating {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  rating: number;
  comment: string | null;
  isHidden: boolean;
  userId: string;
  agentId: string;
}

export interface Agent {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  blockchainIdentifier: string;
  name: string;
  overrideName: string | null;
  description: string | null;
  overrideDescription: string | null;
  apiBaseUrl: string;
  overrideApiBaseUrl: string | null;
  capabilityName: string | null;
  overrideCapabilityName: string | null;
  capabilityVersion: string | null;
  overrideCapabilityVersion: string | null;
  authorName: string | null;
  overrideAuthorName: string | null;
  authorImage: string | null;
  overrideAuthorImage: string | null;
  authorContactEmail: string | null;
  overrideAuthorContactEmail: string | null;
  authorContactOther: string | null;
  overrideAuthorContactOther: string | null;
  authorOrganization: string | null;
  overrideAuthorOrganization: string | null;
  legalPrivacyPolicy: string | null;
  overrideLegalPrivacyPolicy: string | null;
  legalDpa: string | null;
  overrideLegalDpa: string | null;
  legalTerms: string | null;
  overrideLegalTerms: string | null;
  legalOther: string | null;
  overrideLegalOther: string | null;
  lastUptimeCheck: Date;
  uptimeCount: number;
  uptimeCheckCount: number;
  image: string | null;
  overrideImage: string | null;
  icon: string | null;
  metadataVersion: number;
  paymentType: PaymentType;
  pricingId: string;
  status: AgentStatus;
  isShown: boolean;
  riskClassification: RiskClassification;
  demoInput: string | null;
  demoOutput: string | null;
  summary: string | null;
}

export interface Transaction {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  amount: bigint;
  userId: string;
  organizationId: string | null;
}

export interface PublicShare {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  jobId: string | null;
  taskId: string | null;
  token: string;
  allowSearchIndexing: boolean;
}

export type JobShare = PublicShare;

export interface JobInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  eventId: string;
  input: string;
  inputHash: string | null;
  signature: string | null;
}

export interface Blob {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  mimeType: string;
  size: bigint;
  sourceUrl: string;
  status: BlobStatus;
  eventId: string;
}

export interface Link {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  url: string;
  title: string | null;
  eventId: string;
}

export interface JobEvent {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  jobId: string;
  statusHash: string | null;
  status: AgentJobStatus;
  inputSchema: string | null;
  result: string | null;
  input: JobInput | null;
  blobs: Blob[];
  links: Link[];
}

export interface JobPurchase {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  externalId: string;
  jobId: string;
  onChainStatus: OnChainJobStatus | null;
  onChainTransactionHash: string | null;
  onChainTransactionStatus: OnChainTransactionStatus | null;
  resultHash: string | null;
  nextAction: string;
  nextActionErrorType: string | null;
  nextActionErrorNote: string | null;
  errorNote: string | null;
  errorNoteKey: string | null;
}

export interface JobUserSummary {
  id: string;
  name: string;
  image: string | null;
}

export interface JobOrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface JobWorkspaceSummary {
  id: string;
  organizationId: string | null;
  organization: JobOrganizationSummary | null;
}

export interface JobAgentSummary {
  id: string;
  name: string;
  overrideName: string | null;
  icon: string | null;
  image: string | null;
  overrideImage: string | null;
  legalPrivacyPolicy: string | null;
  overrideLegalPrivacyPolicy: string | null;
  legalTerms: string | null;
  overrideLegalTerms: string | null;
  legalDpa: string | null;
  overrideLegalDpa: string | null;
  legalOther: string | null;
  overrideLegalOther: string | null;
}

export interface Job {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  organizationId: string | null;
  agentId: string;
  agentJobId: string;
  jobType: JobType;
  blockchainIdentifier: string | null;
  identifierFromPurchaser: string | null;
  payByTime: Date | null;
  submitResultTime: Date | null;
  unlockTime: Date | null;
  externalDisputeUnlockTime: Date | null;
  sellerVkey: string | null;
  transactionId: string | null;
  refundedTransactionId: string | null;
  name: string | null;
  workspaceId: string;
  taskId: string | null;
  projectId: string | null;
}
