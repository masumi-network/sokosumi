/**
 * Re-export Ably channel name helpers from shared package.
 * This ensures consistent channel naming between publisher (core) and subscriber (web).
 */
export {
  makeAgentJobsChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
} from "@sokosumi/utils";
