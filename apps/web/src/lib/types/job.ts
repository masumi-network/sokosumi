import type { SokosumiJobStatus } from "@/lib/types/core-dto";

export interface SyncJobTransactionResult {
  jobStatus: SokosumiJobStatus;
  extractionContext?: {
    userId: string;
    eventId: string;
    result: string;
  };
}
