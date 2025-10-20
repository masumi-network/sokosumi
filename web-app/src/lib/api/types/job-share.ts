// Explicit TypeScript types for job shares endpoints (for next-openapi-gen typescript mode)

export type JobShareAccessType = "PUBLIC" | "RESTRICTED";

export type JobShareCreator = {
  id: string;
  name: string;
  image: string | null;
};

export type JobShareResponse = {
  createdAt: string; // ISO date
  updated: string; // ISO date
  url: string;
  creator: JobShareCreator;
};

export type JobShareSuccessResponse = {
  success: true;
  data: JobShareResponse;
  timestamp: string;
};

export type JobShareRequestBody = {
  accessType: JobShareAccessType;
  shareWithOrganization?: boolean;
  allowSearchIndexing?: boolean;
};
