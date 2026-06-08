import { SokosumiJobStatus } from "@sokosumi/utils";

export interface SyncJobTransactionResult {
  jobStatus: SokosumiJobStatus;
  extractionContext?: {
    userId: string;
    eventId: string;
    result: string;
  };
}
