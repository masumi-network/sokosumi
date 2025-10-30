import { ScheduleType } from "@sokosumi/database";

// Re-export all job types from database package
export {
  type DemoJobWithStatus,
  finalizedAgentJobStatuses,
  finalizedOnChainJobStatuses,
  type FreeJobWithStatus,
  JobErrorNoteKeys,
  jobInclude,
  jobOrderBy,
  JobStatus,
  type JobWithRelations,
  type JobWithStatus,
  type PaidJobWithStatus,
} from "@sokosumi/database/types/job";

// Web app-specific job scheduling types
export type JobScheduleSelectionType = {
  mode: JobScheduleType;
  timezone: string;
  oneTimeLocalIso?: string;
  cron?: string;
  endsMode?: JobScheduleEndsMode;
  endOnLocalDate?: string; // YYYY-MM-DD (no time)
  endAfterOccurrences?: number;
};

export enum JobScheduleType {
  NOW = "NOW",
  ONE_TIME = "ONE_TIME",
  CRON = "CRON",
}

export enum JobScheduleEndsMode {
  NEVER = "never",
  ON = "on",
  AFTER = "after",
}

// Helper to map Prisma ScheduleType to UI JobScheduleType
export function mapPrismaToUiScheduleType(
  value: ScheduleType,
): JobScheduleType {
  return value === ScheduleType.ONE_TIME
    ? JobScheduleType.ONE_TIME
    : JobScheduleType.CRON;
}
