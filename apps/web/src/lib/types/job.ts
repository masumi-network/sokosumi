import type { SokosumiJobStatus } from "@sokosumi/database";

export interface SyncJobTransactionResult {
  jobStatus: SokosumiJobStatus;
  extractionContext?: {
    userId: string;
    eventId: string;
    result: string;
  };
}
