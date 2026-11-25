import {
  type ProjectSocialProvider as ProjectSocialProviderValue,
  SocialPostStatus,
  type SocialPostStatus as SocialPostStatusValue,
  TaskStatus,
  type TaskStatus as TaskStatusValue,
} from "@sokosumi/core-client";
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  parseAsStringEnum,
  parseAsStringLiteral,
} from "nuqs";
import { CALENDAR_TYPES } from "@/app/calendar/calendar-types";
import { SOCIAL_POST_PROVIDERS } from "@/components/social-platform-filter";

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
// Social lists its drafts and failures in tabs of its own, and the month grid
// already shows what is coming up, so its calendar has no agenda list.
export const SOCIAL_CALENDAR_VIEWS = ["month", "week"] as const;
export const CALENDAR_STATUSES = Object.values(TaskStatus);
export const SOCIAL_POST_STATUSES = Object.values(SocialPostStatus).filter(
  (status) => status !== SocialPostStatus.DRAFT,
);

export const calendarParsers = {
  showCanceled: parseAsBoolean.withDefault(false),
  assigneeId: parseAsString,
  assigneeUserId: parseAsString,
  date: parseAsString,
  projectId: parseAsString,
  scope: parseAsStringLiteral(["owned", "workspace"]).withDefault("workspace"),
  types: parseAsArrayOf(parseAsStringLiteral(CALENDAR_TYPES)),
  status: parseAsStringEnum<TaskStatusValue>(CALENDAR_STATUSES),
  postStatus:
    parseAsStringEnum<Exclude<SocialPostStatusValue, "DRAFT">>(
      SOCIAL_POST_STATUSES,
    ),
  provider: parseAsStringEnum<ProjectSocialProviderValue>(
    SOCIAL_POST_PROVIDERS,
  ),
  timezone: parseAsString,
  view: parseAsStringLiteral(CALENDAR_VIEWS),
};
