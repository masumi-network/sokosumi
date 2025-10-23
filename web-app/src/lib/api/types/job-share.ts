// Explicit TypeScript types for job shares endpoints (for next-openapi-gen typescript mode)

export type JobShareAccessType = "PUBLIC" | "RESTRICTED";

export type JobShareCreator = {
  id: string;
  name: string;
  image: string | null;
};

export type JobShareRecipientOrganization = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
};

export type JobShareResponse = {
  createdAt: string; // ISO date
  updated: string; // ISO date
  url: string;
  creator: JobShareCreator;
  recipientOrganization: JobShareRecipientOrganization | null;
};

export type JobShareSuccessResponse = {
  success: true;
  data: JobShareResponse;
  timestamp: string;
};

export type JobShareRemoveSuccessResponse = {
  success: true;
  timestamp: string;
};

export type JobShareRequestBody = {
  shareWithOrganization?: boolean;
  allowSearchIndexing?: boolean;
};

export type JobShareRemoveRequestBody = {
  removeAll?: boolean;
  removeOrganizationShare?: boolean;
};
