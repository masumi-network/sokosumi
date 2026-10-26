import {
  getChatRoomMessageResults as coreGetChatRoomMessageResults,
  getChatRoomMessageResultsBatch as coreGetChatRoomMessageResultsBatch,
  suggestTaskTags as coreSuggestTaskTags,
} from "@sokosumi/core-client";
import { mapCorePublicSharedResourceResponse } from "@/lib/clients/core.job-share";

/** Pause, resume, and end each have their own Task Schedule route. */
export type TaskScheduleStateAction = "pause" | "resume" | "end";

import type {
  ActivateEnterpriseContractRequest,
  AgentStatus,
  AggregateAdminTaskX402PaymentsByAgentData,
  CreateAdminBadgeCampaignData,
  CreateAdminVendorData,
  CreateChatRoomMessageRequest,
  CreateChatRoomRequest,
  CreateEnterpriseContractRequest,
  CreateTaskScheduleRequest,
  CreateTaskScheduleRunRequest,
  CreateUserWorkspace,
  DeleteJobsByIdShareError,
  DeleteProjectsByIdAdsAccountsByAccountIdData,
  DeleteProjectsByIdAdsConnectionsByAdConnectionIdData,
  DeleteProjectsByIdJobsByJobIdData,
  DeleteProjectsByIdSocialConnectionsByConnectionIdData,
  DeleteProjectsByIdTasksByTaskIdData,
  DeleteTasksByIdShareError,
  GetAgentsByIdJobsData,
  GetAgentsByIdReviewsData,
  GetAgentsData,
  GetCategoriesData,
  GetChatsInvitationsData,
  GetChatsRoomsByIdMessagesData,
  GetChatsRoomsByIdPinnedMessagesData,
  GetChatsRoomsByIdThreadsByParentMessageIdMessagesData,
  GetChatsRoomsByIdThreadsData,
  GetChatsRoomsChannelSlugAvailabilityData,
  GetChatsRoomsData,
  GetChatsRoomsDiscoverableData,
  GetChatsSignalsRoomsByIdDecisionsData,
  GetChatsThreadsEarlierData,
  GetChatsThreadsUnreadData,
  GetCoworkersData,
  GetEnterpriseContractsData,
  GetHistoryData,
  GetImageStudioStateData,
  GetJobsData,
  GetNotificationsData,
  GetProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData,
  GetProjectsByIdAdsAccountsByAccountIdCampaignsData,
  GetProjectsByIdAdsAccountsByAccountIdTargetingLanguagesData,
  GetProjectsByIdAdsAccountsByAccountIdTargetingLocationsData,
  GetProjectsByIdCalendarData,
  GetProjectsByIdImageStudioData,
  GetProjectsByIdSocialConnectionsByConnectionIdStatisticsAudienceData,
  GetProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscoveryData,
  GetProjectsByIdSocialConnectionsByConnectionIdSuggestedTimesData,
  GetProjectsByIdSocialConnectionsStatisticsData,
  GetProjectsByIdSocialPostsData,
  GetProjectsByIdSocialPostsStatisticsData,
  GetProjectsData,
  GetProjectsStatsData,
  GetShareByTokenError,
  GetTasksByIdEventsData,
  GetTasksData,
  GetTasksSchedulesByIdRunsData,
  GetTasksSchedulesData,
  GetTasksSummaryData,
  GetTransactionsDailyData,
  GetTransactionsData,
  GetWorkspacesCalendarData,
  GetWorkspacesCalendarSourcesData,
  ListAdminTaskX402PaymentsData,
  Notice,
  PaginationMetadata,
  PatchAdminVendorData,
  PatchChatsRoomsByIdData,
  PatchChatsRoomsByIdMessagesByMessageIdData,
  PatchCoworkersByIdData,
  PatchCoworkersByIdWhitelistData,
  PatchEnterpriseContractRequest,
  PatchJobsByIdData,
  PatchNotificationsByIdReadData,
  PatchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData,
  PatchProjectsByIdData,
  PatchProjectsByIdSocialPostsByPostIdData,
  PatchTasksByIdData,
  PatchVendorData,
  PostAgentsByIdJobsData,
  PostAgentsByIdJobsError,
  PostAgentsByIdRatingsData,
  PostChatsRoomsByIdFilesData,
  PostChatsRoomsByIdInviteLinksData,
  PostChatsRoomsByIdMembersData,
  PostChatsRoomsByIdMessagesByMessageIdUnfurlsRemoveData,
  PostChatsRoomsByIdMessagesData,
  PostChatsRoomsData,
  PostComposioCallbackCompleteData,
  PostJobsByIdInputsData,
  PostOrganizationsByIdFilesCleanupData,
  PostOrganizationsByIdFilesData,
  PostOrganizationsByIdInviteLinksData,
  PostProjectsByIdAdsAccountsByAccountIdCampaignsData,
  PostProjectsByIdAdsAccountsData,
  PostProjectsByIdAdsConnectionsFinalizeData,
  PostProjectsByIdAdsConnectionsInitiateData,
  PostProjectsByIdCloseCancelOwedData,
  PostProjectsByIdCloseData,
  PostProjectsByIdCloseRetryData,
  PostProjectsByIdImageStudioJobsData,
  PostProjectsByIdImageStudioVideoJobsData,
  PostProjectsByIdJobsData,
  PostProjectsByIdSocialAccountPostsByAccountPostIdRecycleData,
  PostProjectsByIdSocialConnectionsByConnectionIdStatisticsRefreshData,
  PostProjectsByIdSocialConnectionsFinalizeData,
  PostProjectsByIdSocialConnectionsInitiateData,
  PostProjectsByIdSocialPostsByPostIdCancelData,
  PostProjectsByIdSocialPostsByPostIdPublishData,
  PostProjectsByIdSocialPostsByPostIdScheduleData,
  PostProjectsByIdSocialPostsData,
  PostProjectsByIdTasksData,
  PostProjectsData,
  PostTasksByIdFilesData,
  PostTasksByIdLinksData,
  PostTasksData,
  PostUsersByIdFilesData,
  PostVendorsByIdFilesCleanupData,
  PostVendorsByIdFilesData,
  PostWorkspacesDesignMdAdhocData,
  PutChatsSignalsMessagesByMessageIdCorrectionsData,
  PutChatsSignalsMessagesByMessageIdLoopData,
  PutJobsByIdShareError,
  PutOrganizationsByIdDesignMdData,
  PutProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData,
  PutProjectsByIdAdsMarketData,
  PutProjectsByIdDesignMdData,
  PutTasksByIdShareError,
  PutUsersByIdDesignMdData,
  RefundAdminTaskX402PaymentData,
  ResolveAdminTaskX402PaymentData,
  UpdateAdminBadgeCampaignData,
  UpdateTaskScheduleRequest,
  UpdateTaskScheduleRunRequest,
} from "@sokosumi/core-client";
import {
  addAdminMatchedChannelParticipant as coreAddAdminMatchedChannelParticipant,
  addAdminMatchedChannelParticipantsFromOrganization as coreAddAdminMatchedChannelParticipantsFromOrganization,
  addAdminOrganizationMember as coreAddAdminOrganizationMember,
  aggregateAdminTaskX402PaymentsByAgent as coreAggregateAdminTaskX402PaymentsByAgent,
  archiveAdminMatchedChannel as coreArchiveAdminMatchedChannel,
  assignAdminOrganizationMemberSeat as coreAssignAdminOrganizationMemberSeat,
  assignCoworkerDeveloper as coreAssignCoworkerDeveloper,
  claimCoupon as coreClaimCoupon,
  createAdminBadgeCampaign as coreCreateAdminBadgeCampaign,
  createAdminFreeCreditGrant as coreCreateAdminFreeCreditGrant,
  createAdminInvoice as coreCreateAdminInvoice,
  createAdminMatchedChannel as coreCreateAdminMatchedChannel,
  createAdminVendor as coreCreateAdminVendor,
  createCoworkerWorkspaceAccess as coreCreateCoworkerWorkspaceAccess,
  createCreditCheckoutSession as coreCreateCreditCheckoutSession,
  deleteAdminAgentMetadataOverride as coreDeleteAdminAgentMetadataOverride,
  deleteAdminBadgeCampaign as coreDeleteAdminBadgeCampaign,
  deleteAdminInvoice as coreDeleteAdminInvoice,
  deleteAdminMatchedChannel as coreDeleteAdminMatchedChannel,
  deleteChatsRoomsById as coreDeleteChatsRoomsById,
  deleteChatsRoomsByIdCoworkersByCoworkerId as coreDeleteChatsRoomsByIdCoworkersByCoworkerId,
  deleteChatsRoomsByIdInvitationsByInvitationId as coreDeleteChatsRoomsByIdInvitationsByInvitationId,
  deleteChatsRoomsByIdInviteLinksByToken as coreDeleteChatsRoomsByIdInviteLinksByToken,
  deleteChatsRoomsByIdMembersByUserId as coreDeleteChatsRoomsByIdMembersByUserId,
  deleteChatsRoomsByIdMembersMe as coreDeleteChatsRoomsByIdMembersMe,
  deleteChatsRoomsByIdMessagesByMessageId as coreDeleteChatsRoomsByIdMessagesByMessageId,
  deleteChatsRoomsByIdMessagesByMessageIdPin as coreDeleteChatsRoomsByIdMessagesByMessageIdPin,
  deleteChatsRoomsByIdMessagesByMessageIdReactionsByEmoji as coreDeleteChatsRoomsByIdMessagesByMessageIdReactionsByEmoji,
  deleteChatsRoomsByIdMute as coreDeleteChatsRoomsByIdMute,
  deleteChatsRoomsByIdSokoBotsBySokoBotId as coreDeleteChatsRoomsByIdSokoBotsBySokoBotId,
  deleteChatsRoomsByIdStar as coreDeleteChatsRoomsByIdStar,
  deleteChatsRoomsByIdThreadsByParentMessageIdMute as coreDeleteChatsRoomsByIdThreadsByParentMessageIdMute,
  deleteCoworkersById as coreDeleteCoworkersById,
  deleteCoworkersByIdImage as coreDeleteCoworkersByIdImage,
  deleteJobsByIdShare as coreDeleteJobsByIdShare,
  deleteOrganizationsByIdInviteLinksByToken as coreDeleteOrganizationsByIdInviteLinksByToken,
  deleteOrganizationsByIdMembersByMemberIdSeat as coreDeleteOrganizationsByIdMembersByMemberIdSeat,
  deleteProjectsByIdAdsAccountsByAccountId as coreDeleteProjectsByIdAdsAccountsByAccountId,
  deleteProjectsByIdAdsConnectionsByAdConnectionId as coreDeleteProjectsByIdAdsConnectionsByAdConnectionId,
  deleteProjectsByIdDesignMd as coreDeleteProjectsByIdDesignMd,
  deleteProjectsByIdJobsByJobId as coreDeleteProjectsByIdJobsByJobId,
  deleteProjectsByIdSocialConnectionsByConnectionId as coreDeleteProjectsByIdSocialConnectionsByConnectionId,
  deleteProjectsByIdStar as coreDeleteProjectsByIdStar,
  deleteProjectsByIdTasksByTaskId as coreDeleteProjectsByIdTasksByTaskId,
  deleteTasksById as coreDeleteTasksById,
  deleteTasksByIdLinksByLinkId as coreDeleteTasksByIdLinksByLinkId,
  deleteTasksByIdParticipantsByUserId as coreDeleteTasksByIdParticipantsByUserId,
  deleteTasksByIdShare as coreDeleteTasksByIdShare,
  deleteTasksSchedulesById as coreDeleteTasksSchedulesById,
  deleteUsersByIdOauthConsentsByConsentId as coreDeleteUsersByIdOauthConsentsByConsentId,
  deleteUsersByIdWorkspacesByWorkspaceId as coreDeleteUsersByIdWorkspacesByWorkspaceId,
  endAdminBadgeCampaign as coreEndAdminBadgeCampaign,
  getAdminAgent as coreGetAdminAgent,
  getAdminInvoice as coreGetAdminInvoice,
  getAdminMatchedChannel as coreGetAdminMatchedChannel,
  getAdminOrganizationBySlug as coreGetAdminOrganizationBySlug,
  getAdminTask as coreGetAdminTask,
  getAgents as coreGetAgents,
  getAgentsById as coreGetAgentsById,
  getAgentsByIdInputSchema as coreGetAgentsByIdInputSchema,
  getAgentsByIdJobs as coreGetAgentsByIdJobs,
  getAgentsByIdRatingsEligibility as coreGetAgentsByIdRatingsEligibility,
  getAgentsByIdReviews as coreGetAgentsByIdReviews,
  getAgentsByIdReviewsMe as coreGetAgentsByIdReviewsMe,
  getCategories as coreGetCategories,
  getChatRoomInviteLinksByToken as coreGetChatRoomInviteLinksByToken,
  getChatsInvitations as coreGetChatsInvitations,
  getChatsInvitationsById as coreGetChatsInvitationsById,
  getChatsRooms as coreGetChatsRooms,
  getChatsRoomsById as coreGetChatsRoomsById,
  getChatsRoomsByIdInvitations as coreGetChatsRoomsByIdInvitations,
  getChatsRoomsByIdInviteLinks as coreGetChatsRoomsByIdInviteLinks,
  getChatsRoomsByIdMessages as coreGetChatsRoomsByIdMessages,
  getChatsRoomsByIdMessagesByMessageId as coreGetChatsRoomsByIdMessagesByMessageId,
  getChatsRoomsByIdPinnedMessages as coreGetChatsRoomsByIdPinnedMessages,
  getChatsRoomsByIdThreads as coreGetChatsRoomsByIdThreads,
  getChatsRoomsByIdThreadsByParentMessageId as coreGetChatsRoomsByIdThreadsByParentMessageId,
  getChatsRoomsByIdThreadsByParentMessageIdMessages as coreGetChatsRoomsByIdThreadsByParentMessageIdMessages,
  getChatsRoomsByIdThreadsUnreadCount as coreGetChatsRoomsByIdThreadsUnreadCount,
  getChatsRoomsChannelSlugAvailability as coreGetChatsRoomsChannelSlugAvailability,
  getChatsRoomsDiscoverable as coreGetChatsRoomsDiscoverable,
  getChatsSignalsMessagesByMessageIdRouting as coreGetChatsSignalsMessagesByMessageIdRouting,
  getChatsSignalsNeedsYou as coreGetChatsSignalsNeedsYou,
  getChatsSignalsOpenLoops as coreGetChatsSignalsOpenLoops,
  getChatsSignalsRoomsByIdCatchUp as coreGetChatsSignalsRoomsByIdCatchUp,
  getChatsSignalsRoomsByIdDecisions as coreGetChatsSignalsRoomsByIdDecisions,
  getChatsSignalsSummary as coreGetChatsSignalsSummary,
  getChatsThreadsEarlier as coreGetChatsThreadsEarlier,
  getChatsThreadsUnread as coreGetChatsThreadsUnread,
  getCheckoutSessionAnalytics as coreGetCheckoutSessionAnalytics,
  getCouponDetails as coreGetCouponDetails,
  getCoworkers as coreGetCoworkers,
  getCoworkersById as coreGetCoworkersById,
  getCreditTopUpPriceCatalog as coreGetCreditTopUpPriceCatalog,
  getDeveloperOwnedCoworkerTask as coreGetDeveloperOwnedCoworkerTask,
  getEnterpriseContracts as coreGetEnterpriseContracts,
  getEnterpriseContractsById as coreGetEnterpriseContractsById,
  getEnterpriseContractsByIdPeriodsPreview as coreGetEnterpriseContractsByIdPeriodsPreview,
  getHistory as coreGetHistory,
  getImageStudioCatalog as coreGetImageStudioCatalog,
  getImageStudioState as coreGetImageStudioState,
  getInvitationsById as coreGetInvitationsById,
  getJobs as coreGetJobs,
  getJobsById as coreGetJobsById,
  getNotifications as coreGetNotifications,
  getNotificationsCounts as coreGetNotificationsCounts,
  getOrganizationBySlug as coreGetOrganizationBySlug,
  getOrganizationEnterpriseContractSummary as coreGetOrganizationEnterpriseContractSummary,
  getOrganizationInviteLinksByToken as coreGetOrganizationInviteLinksByToken,
  getOrganizationsById as coreGetOrganizationsById,
  getOrganizationsByIdBillingDetails as coreGetOrganizationsByIdBillingDetails,
  getOrganizationsByIdBillingPlan as coreGetOrganizationsByIdBillingPlan,
  getOrganizationsByIdCoworkerAccess as coreGetOrganizationsByIdCoworkerAccess,
  getOrganizationsByIdDeletion as coreGetOrganizationsByIdDeletion,
  getOrganizationsByIdInvitations as coreGetOrganizationsByIdInvitations,
  getOrganizationsByIdInviteLinks as coreGetOrganizationsByIdInviteLinks,
  getOrganizationsByIdMembers as coreGetOrganizationsByIdMembers,
  getOrganizationsByIdMembersMeSeat as coreGetOrganizationsByIdMembersMeSeat,
  getOrganizationsByIdSeatSummary as coreGetOrganizationsByIdSeatSummary,
  getOrganizationsByIdStripeCustomer as coreGetOrganizationsByIdStripeCustomer,
  getOrganizationsByIdSubscription as coreGetOrganizationsByIdSubscription,
  getOrganizationsByIdVendorGrants as coreGetOrganizationsByIdVendorGrants,
  getProjects as coreGetProjects,
  getProjectsById as coreGetProjectsById,
  getProjectsByIdAdsAccounts as coreGetProjectsByIdAdsAccounts,
  getProjectsByIdAdsAccountsByAccountIdCampaigns as coreGetProjectsByIdAdsAccountsByAccountIdCampaigns,
  getProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId as coreGetProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
  getProjectsByIdAdsAccountsByAccountIdTargetingLanguages as coreGetProjectsByIdAdsAccountsByAccountIdTargetingLanguages,
  getProjectsByIdAdsAccountsByAccountIdTargetingLocations as coreGetProjectsByIdAdsAccountsByAccountIdTargetingLocations,
  getProjectsByIdAdsMarket as coreGetProjectsByIdAdsMarket,
  getProjectsByIdAdsMarketAds as coreGetProjectsByIdAdsMarketAds,
  getProjectsByIdAdsMarketKeywords as coreGetProjectsByIdAdsMarketKeywords,
  getProjectsByIdCalendar as coreGetProjectsByIdCalendar,
  getProjectsByIdClose as coreGetProjectsByIdClose,
  getProjectsByIdContextMd as coreGetProjectsByIdContextMd,
  getProjectsByIdImageStudio as coreGetProjectsByIdImageStudio,
  getProjectsByIdImageStudioAssetsByAssetIdSocialMedia as coreGetProjectsByIdImageStudioAssetsByAssetIdSocialMedia,
  getProjectsByIdNeedsAttention as coreGetProjectsByIdNeedsAttention,
  getProjectsByIdSocialConnections as coreGetProjectsByIdSocialConnections,
  getProjectsByIdSocialConnectionsByConnectionIdStatisticsAudience as coreGetProjectsByIdSocialConnectionsByConnectionIdStatisticsAudience,
  getProjectsByIdSocialConnectionsByConnectionIdStatisticsBenchmark as coreGetProjectsByIdSocialConnectionsByConnectionIdStatisticsBenchmark,
  getProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscovery as coreGetProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscovery,
  getProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes as coreGetProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes,
  getProjectsByIdSocialConnectionsStatistics as coreGetProjectsByIdSocialConnectionsStatistics,
  getProjectsByIdSocialPosts as coreGetProjectsByIdSocialPosts,
  getProjectsByIdSocialPostsByPostId as coreGetProjectsByIdSocialPostsByPostId,
  getProjectsByIdSocialPostsStatistics as coreGetProjectsByIdSocialPostsStatistics,
  getProjectsStarred as coreGetProjectsStarred,
  getProjectsStats as coreGetProjectsStats,
  getShareByToken as coreGetShareByToken,
  getSubscriptionCatalog as coreGetSubscriptionCatalog,
  getTaskScheduleAssignees as coreGetTaskScheduleAssignees,
  getTasks as coreGetTasks,
  getTasksById as coreGetTasksById,
  getTasksByIdEvents as coreGetTasksByIdEvents,
  getTasksByIdLinks as coreGetTasksByIdLinks,
  getTasksByIdWorkspace as coreGetTasksByIdWorkspace,
  getTasksSchedules as coreGetTasksSchedules,
  getTasksSchedulesById as coreGetTasksSchedulesById,
  getTasksSchedulesByIdRuns as coreGetTasksSchedulesByIdRuns,
  getTasksSummary as coreGetTasksSummary,
  getToolsSiteIcon as coreGetToolsSiteIcon,
  getTransactions as coreGetTransactions,
  getTransactionsDaily as coreGetTransactionsDaily,
  getUserBadgeCampaigns as coreGetUserBadgeCampaigns,
  getUsersById as coreGetUsersById,
  getUsersByIdBillingDetails as coreGetUsersByIdBillingDetails,
  getUsersByIdCoworkerAccess as coreGetUsersByIdCoworkerAccess,
  getUsersByIdCredits as coreGetUsersByIdCredits,
  getUsersByIdDeletion as coreGetUsersByIdDeletion,
  getUsersByIdMembers as coreGetUsersByIdMembers,
  getUsersByIdNoticesPending as coreGetUsersByIdNoticesPending,
  getUsersByIdOrganizations as coreGetUsersByIdOrganizations,
  getUsersByIdOrganizationsByOrganizationIdCredits as coreGetUsersByIdOrganizationsByOrganizationIdCredits,
  getUsersByIdOrganizationsByOrganizationIdMember as coreGetUsersByIdOrganizationsByOrganizationIdMember,
  getUsersByIdPendingOrganizationInvitations as coreGetUsersByIdPendingOrganizationInvitations,
  getUsersByIdSignUp as coreGetUsersByIdSignUp,
  getUsersByIdStripeCustomer as coreGetUsersByIdStripeCustomer,
  getUsersByIdSubscription as coreGetUsersByIdSubscription,
  getUsersByIdVendorGrants as coreGetUsersByIdVendorGrants,
  getUsersByIdWorkspaces as coreGetUsersByIdWorkspaces,
  getWorkspacesById as coreGetWorkspacesById,
  getWorkspacesCalendar as coreGetWorkspacesCalendar,
  getWorkspacesCalendarSources as coreGetWorkspacesCalendarSources,
  getWorkspacesDesignMd as coreGetWorkspacesDesignMd,
  listAdminAgents as coreListAdminAgents,
  listAdminBadgeCampaigns as coreListAdminBadgeCampaigns,
  listAdminInvoices as coreListAdminInvoices,
  listAdminMatchedChannels as coreListAdminMatchedChannels,
  listAdminOrganizationMembers as coreListAdminOrganizationMembers,
  listAdminOrganizations as coreListAdminOrganizations,
  listAdminTasks as coreListAdminTasks,
  listAdminTaskX402Payments as coreListAdminTaskX402Payments,
  listAdminUsers as coreListAdminUsers,
  listAdminVendors as coreListAdminVendors,
  listCoworkerAssignments as coreListCoworkerAssignments,
  listCoworkerWorkspaceAccess as coreListCoworkerWorkspaceAccess,
  listCreditPrices as coreListCreditPrices,
  listDeveloperOwnedCoworkerTasks as coreListDeveloperOwnedCoworkerTasks,
  listMyVendorMemberships as coreListMyVendorMemberships,
  listVendorMembers as coreListVendorMembers,
  listVendors as coreListVendors,
  markAdminInvoicePaid as coreMarkAdminInvoicePaid,
  markUserBadgeCampaignSeen as coreMarkUserBadgeCampaignSeen,
  patchAdminAgentMetadataOverride as corePatchAdminAgentMetadataOverride,
  patchAdminVendor as corePatchAdminVendor,
  patchChatsRoomsById as corePatchChatsRoomsById,
  patchChatsRoomsByIdMessagesByMessageId as corePatchChatsRoomsByIdMessagesByMessageId,
  patchCoworkersById as corePatchCoworkersById,
  patchCoworkersByIdWhitelist as corePatchCoworkersByIdWhitelist,
  patchEnterpriseContractsById as corePatchEnterpriseContractsById,
  patchJobsById as corePatchJobsById,
  patchNotificationsByIdRead as corePatchNotificationsByIdRead,
  patchNotificationsReadAll as corePatchNotificationsReadAll,
  patchProjectsById as corePatchProjectsById,
  patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId as corePatchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
  patchProjectsByIdSocialPostsByPostId as corePatchProjectsByIdSocialPostsByPostId,
  patchTasksById as corePatchTasksById,
  patchTasksSchedulesById as corePatchTasksSchedulesById,
  patchTasksSchedulesByIdRunsByRunId as corePatchTasksSchedulesByIdRunsByRunId,
  patchVendor as corePatchVendor,
  postAgentsByIdJobs as corePostAgentsByIdJobs,
  postAgentsByIdRatings as corePostAgentsByIdRatings,
  postChatRoomInviteLinksByTokenAccept as corePostChatRoomInviteLinksByTokenAccept,
  postChatsInvitationsByIdAccept as corePostChatsInvitationsByIdAccept,
  postChatsInvitationsByIdDecline as corePostChatsInvitationsByIdDecline,
  postChatsRooms as corePostChatsRooms,
  postChatsRoomsByIdArchive as corePostChatsRoomsByIdArchive,
  postChatsRoomsByIdFiles as corePostChatsRoomsByIdFiles,
  postChatsRoomsByIdInvitations as corePostChatsRoomsByIdInvitations,
  postChatsRoomsByIdInviteLinks as corePostChatsRoomsByIdInviteLinks,
  postChatsRoomsByIdMembers as corePostChatsRoomsByIdMembers,
  postChatsRoomsByIdMembersMe as corePostChatsRoomsByIdMembersMe,
  postChatsRoomsByIdMessages as corePostChatsRoomsByIdMessages,
  postChatsRoomsByIdMessagesByMessageIdMentionsByMentionIdRetry as corePostChatsRoomsByIdMessagesByMessageIdMentionsByMentionIdRetry,
  postChatsRoomsByIdMessagesByMessageIdPin as corePostChatsRoomsByIdMessagesByMessageIdPin,
  postChatsRoomsByIdMessagesByMessageIdSendToSelf as corePostChatsRoomsByIdMessagesByMessageIdSendToSelf,
  postChatsRoomsByIdMessagesByMessageIdUnfurlsRemove as corePostChatsRoomsByIdMessagesByMessageIdUnfurlsRemove,
  postChatsRoomsByIdMute as corePostChatsRoomsByIdMute,
  postChatsRoomsByIdRead as corePostChatsRoomsByIdRead,
  postChatsRoomsByIdRestore as corePostChatsRoomsByIdRestore,
  postChatsRoomsByIdStar as corePostChatsRoomsByIdStar,
  postChatsRoomsByIdThreadsByParentMessageIdMute as corePostChatsRoomsByIdThreadsByParentMessageIdMute,
  postChatsRoomsByIdThreadsByParentMessageIdRead as corePostChatsRoomsByIdThreadsByParentMessageIdRead,
  postChatsRoomsByIdThreadsRead as corePostChatsRoomsByIdThreadsRead,
  postChatsRoomsByIdUnread as corePostChatsRoomsByIdUnread,
  postComposioCallbackComplete as corePostComposioCallbackComplete,
  postCoworkersByIdImage as corePostCoworkersByIdImage,
  postCoworkersByIdUnarchive as corePostCoworkersByIdUnarchive,
  postEnterpriseContracts as corePostEnterpriseContracts,
  postEnterpriseContractsByIdActivate as corePostEnterpriseContractsByIdActivate,
  postEnterpriseContractsByIdCancel as corePostEnterpriseContractsByIdCancel,
  postJobsByIdInputs as corePostJobsByIdInputs,
  postJobsByIdRefund as corePostJobsByIdRefund,
  postOrganizationInviteLinksByTokenAccept as corePostOrganizationInviteLinksByTokenAccept,
  postOrganizationsByIdCoworkerAccessByAccessIdApprove as corePostOrganizationsByIdCoworkerAccessByAccessIdApprove,
  postOrganizationsByIdCoworkerAccessByAccessIdDeny as corePostOrganizationsByIdCoworkerAccessByAccessIdDeny,
  postOrganizationsByIdCoworkerAccessByAccessIdRevoke as corePostOrganizationsByIdCoworkerAccessByAccessIdRevoke,
  postOrganizationsByIdFiles as corePostOrganizationsByIdFiles,
  postOrganizationsByIdFilesCleanup as corePostOrganizationsByIdFilesCleanup,
  postOrganizationsByIdInviteLinks as corePostOrganizationsByIdInviteLinks,
  postOrganizationsByIdStripeCustomer as corePostOrganizationsByIdStripeCustomer,
  postOrganizationsByIdVendorGrants as corePostOrganizationsByIdVendorGrants,
  postOrganizationsByIdVendorGrantsByGrantIdApprove as corePostOrganizationsByIdVendorGrantsByGrantIdApprove,
  postOrganizationsByIdVendorGrantsByGrantIdDeny as corePostOrganizationsByIdVendorGrantsByGrantIdDeny,
  postOrganizationsByIdVendorGrantsByGrantIdRevoke as corePostOrganizationsByIdVendorGrantsByGrantIdRevoke,
  postProjects as corePostProjects,
  postProjectsByIdAdsAccounts as corePostProjectsByIdAdsAccounts,
  postProjectsByIdAdsAccountsByAccountIdCampaigns as corePostProjectsByIdAdsAccountsByAccountIdCampaigns,
  postProjectsByIdAdsConnectionsFinalize as corePostProjectsByIdAdsConnectionsFinalize,
  postProjectsByIdAdsConnectionsInitiate as corePostProjectsByIdAdsConnectionsInitiate,
  postProjectsByIdClose as corePostProjectsByIdClose,
  postProjectsByIdCloseCancelOwed as corePostProjectsByIdCloseCancelOwed,
  postProjectsByIdCloseRetry as corePostProjectsByIdCloseRetry,
  postProjectsByIdImageStudioJobs as corePostProjectsByIdImageStudioJobs,
  postProjectsByIdImageStudioJobsByJobIdCancel as corePostProjectsByIdImageStudioJobsByJobIdCancel,
  postProjectsByIdImageStudioVideoJobs as corePostProjectsByIdImageStudioVideoJobs,
  postProjectsByIdJobs as corePostProjectsByIdJobs,
  postProjectsByIdSocialAccountPostsByAccountPostIdRecycle as corePostProjectsByIdSocialAccountPostsByAccountPostIdRecycle,
  postProjectsByIdSocialConnectionsByConnectionIdStatisticsRefresh as corePostProjectsByIdSocialConnectionsByConnectionIdStatisticsRefresh,
  postProjectsByIdSocialConnectionsFinalize as corePostProjectsByIdSocialConnectionsFinalize,
  postProjectsByIdSocialConnectionsInitiate as corePostProjectsByIdSocialConnectionsInitiate,
  postProjectsByIdSocialPosts as corePostProjectsByIdSocialPosts,
  postProjectsByIdSocialPostsByPostIdCancel as corePostProjectsByIdSocialPostsByPostIdCancel,
  postProjectsByIdSocialPostsByPostIdDuplicate as corePostProjectsByIdSocialPostsByPostIdDuplicate,
  postProjectsByIdSocialPostsByPostIdPublish as corePostProjectsByIdSocialPostsByPostIdPublish,
  postProjectsByIdSocialPostsByPostIdSchedule as corePostProjectsByIdSocialPostsByPostIdSchedule,
  postProjectsByIdSocialPostsByPostIdStatisticsRefresh as corePostProjectsByIdSocialPostsByPostIdStatisticsRefresh,
  postProjectsByIdStar as corePostProjectsByIdStar,
  postProjectsByIdTasks as corePostProjectsByIdTasks,
  postTasks as corePostTasks,
  postTasksByIdEvents as corePostTasksByIdEvents,
  postTasksByIdFiles as corePostTasksByIdFiles,
  postTasksByIdLinks as corePostTasksByIdLinks,
  postTasksByIdParticipants as corePostTasksByIdParticipants,
  postTasksSchedules as corePostTasksSchedules,
  postTasksSchedulesByIdEnd as corePostTasksSchedulesByIdEnd,
  postTasksSchedulesByIdPause as corePostTasksSchedulesByIdPause,
  postTasksSchedulesByIdResume as corePostTasksSchedulesByIdResume,
  postTasksSchedulesByIdRuns as corePostTasksSchedulesByIdRuns,
  postUsersByIdCoworkerAccessByAccessIdApprove as corePostUsersByIdCoworkerAccessByAccessIdApprove,
  postUsersByIdCoworkerAccessByAccessIdDeny as corePostUsersByIdCoworkerAccessByAccessIdDeny,
  postUsersByIdCoworkerAccessByAccessIdRevoke as corePostUsersByIdCoworkerAccessByAccessIdRevoke,
  postUsersByIdFiles as corePostUsersByIdFiles,
  postUsersByIdNoticesByNoticeIdAcknowledge as corePostUsersByIdNoticesByNoticeIdAcknowledge,
  postUsersByIdStripeCustomer as corePostUsersByIdStripeCustomer,
  postUsersByIdVendorGrants as corePostUsersByIdVendorGrants,
  postUsersByIdVendorGrantsByGrantIdApprove as corePostUsersByIdVendorGrantsByGrantIdApprove,
  postUsersByIdVendorGrantsByGrantIdDeny as corePostUsersByIdVendorGrantsByGrantIdDeny,
  postUsersByIdVendorGrantsByGrantIdRevoke as corePostUsersByIdVendorGrantsByGrantIdRevoke,
  postUsersByIdWorkspaces as corePostUsersByIdWorkspaces,
  postVendorsByIdFiles as corePostVendorsByIdFiles,
  postVendorsByIdFilesCleanup as corePostVendorsByIdFilesCleanup,
  postWorkspacesDesignMdAdhoc as corePostWorkspacesDesignMdAdhoc,
  putChatsRoomsByIdMessagesByMessageIdReactionsByEmoji as corePutChatsRoomsByIdMessagesByMessageIdReactionsByEmoji,
  putChatsRoomsStarred as corePutChatsRoomsStarred,
  putChatsSignalsMessagesByMessageIdCorrections as corePutChatsSignalsMessagesByMessageIdCorrections,
  putChatsSignalsMessagesByMessageIdLoop as corePutChatsSignalsMessagesByMessageIdLoop,
  putJobsByIdShare as corePutJobsByIdShare,
  putJobsByIdWorkspace as corePutJobsByIdWorkspace,
  putOrganizationsByIdDesignMd as corePutOrganizationsByIdDesignMd,
  putOrganizationsByIdMembersByMemberIdSeat as corePutOrganizationsByIdMembersByMemberIdSeat,
  putOrganizationsByIdSubscriptionSeats as corePutOrganizationsByIdSubscriptionSeats,
  putProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId as corePutProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
  putProjectsByIdAdsMarket as corePutProjectsByIdAdsMarket,
  putProjectsByIdDesignMd as corePutProjectsByIdDesignMd,
  putTasksByIdShare as corePutTasksByIdShare,
  putTasksByIdWorkspace as corePutTasksByIdWorkspace,
  putUsersByIdDesignMd as corePutUsersByIdDesignMd,
  putUsersByIdWorkspacesPreferred as corePutUsersByIdWorkspacesPreferred,
  refundAdminTaskX402Payment as coreRefundAdminTaskX402Payment,
  removeAdminMatchedChannelParticipant as coreRemoveAdminMatchedChannelParticipant,
  removeAdminOrganizationMember as coreRemoveAdminOrganizationMember,
  resolveAdminTaskX402Payment as coreResolveAdminTaskX402Payment,
  restoreAdminMatchedChannel as coreRestoreAdminMatchedChannel,
  revokeCoworkerWorkspaceAccessAsPlatformAdmin as coreRevokeCoworkerWorkspaceAccessAsPlatformAdmin,
  searchAdminOrganizations as coreSearchAdminOrganizations,
  searchAdminUsers as coreSearchAdminUsers,
  searchChatSkills as coreSearchChatSkills,
  startAdminBadgeCampaign as coreStartAdminBadgeCampaign,
  startAdminImpersonation as coreStartAdminImpersonation,
  stopAdminImpersonation as coreStopAdminImpersonation,
  unassignAdminOrganizationMemberSeat as coreUnassignAdminOrganizationMemberSeat,
  unassignCoworkerDeveloper as coreUnassignCoworkerDeveloper,
  updateAdminBadgeCampaign as coreUpdateAdminBadgeCampaign,
  updateAdminOrganizationMemberRole as coreUpdateAdminOrganizationMemberRole,
  NoticeKind,
} from "@sokosumi/core-client";
import {
  CoreApiRequestError,
  executeCoreOperation,
  executeCoreOperationWithResponse,
  type GetCoreClient,
} from "./core.request";
import { createSokoBotClient } from "./core.soko-bot";
import { createSokoBotAvatarClient } from "./core.soko-bot-avatars";

export type CoreApiPagination = PaginationMetadata;

export interface CoreApiMeta {
  requestId?: string;
  timestamp?: string;
  pagination?: CoreApiPagination;
}

export interface CoreApiResponse<T> {
  data: T;
  meta?: CoreApiMeta;
}

const CURRENT_USER_PATH_ID = "me";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function transformHistoryResponseEnvelope(data: any) {
  data.data = data.data.map((item: any) => ({
    ...item,
    createdAt: toDate(item.createdAt),
    archivedAt: item.archivedAt ? toDate(item.archivedAt) : null,
  }));
  if (data.meta?.timestamp) {
    data.meta.timestamp = toDate(data.meta.timestamp);
  }

  return data;
}

function transformTransactionsResponseEnvelope(data: any) {
  data.data = data.data.map((item: any) => ({
    ...item,
    consumedAt: toDate(item.consumedAt),
  }));
  if (data.meta?.timestamp) {
    data.meta.timestamp = toDate(data.meta.timestamp);
  }
  return data;
}

function transformTaskListResponseEnvelope(data: any) {
  data.data = (data.data ?? []).map((item: any) => {
    item.createdAt = toDate(item.createdAt);
    item.updatedAt = toDate(item.updatedAt);
    if (item.runAt) {
      item.runAt = toDate(item.runAt);
    }

    return item;
  });
  if (data.meta?.timestamp) {
    data.meta.timestamp = toDate(data.meta.timestamp);
  }

  return data;
}

function transformTaskResponseEnvelope(data: any) {
  const task = data.data;

  task.createdAt = toDate(task.createdAt);
  task.updatedAt = toDate(task.updatedAt);
  if (task.runAt) {
    task.runAt = toDate(task.runAt);
  }
  task.events = task.events.map((event: any) => ({
    ...event,
    createdAt: toDate(event.createdAt),
    updatedAt: toDate(event.updatedAt),
  }));
  task.jobs = task.jobs.map((job: any) => ({
    ...job,
    createdAt: toDate(job.createdAt),
    updatedAt: toDate(job.updatedAt),
    completedAt: job.completedAt ? toDate(job.completedAt) : null,
  }));
  task.share = task.share
    ? {
        ...task.share,
        createdAt: toDate(task.share.createdAt),
        updatedAt: toDate(task.share.updatedAt),
      }
    : null;
  task.links = task.links.map((link: any) => ({
    ...link,
    createdAt: toDate(link.createdAt),
    updatedAt: toDate(link.updatedAt),
  }));
  data.meta.timestamp = toDate(data.meta.timestamp);

  return data;
}

/** A `.catch` handler: Core's 404 becomes null; any other error propagates. */
function nullWhenNotFound(error: unknown): null {
  if (error instanceof CoreApiRequestError && error.status === 404) return null;
  throw error;
}

export function createCoreClient(getClient: GetCoreClient) {
  async function getChatRooms(query?: GetChatsRoomsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRooms({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch chat rooms",
    );
  }

  async function getChatRoomInvitations(
    query?: GetChatsInvitationsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsInvitations({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch chat room invitations",
    );
  }

  async function acceptChatRoomInvitation(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsInvitationsByIdAccept({
          client,
          path: { id },
        }),
      "Failed to accept chat room invitation",
    );
  }

  async function declineChatRoomInvitation(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsInvitationsByIdDecline({
          client,
          path: { id },
        }),
      "Failed to decline chat room invitation",
    );
  }

  async function getChatRoomInvitation(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsInvitationsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch chat room invitation",
    );
  }

  async function listChatRoomInvitations(roomId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdInvitations({
          client,
          path: { id: roomId },
          cache: "no-store",
        }),
      "Failed to fetch room invitations",
    );
  }

  async function createChatRoomInvitation(roomId: string, email: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdInvitations({
          client,
          path: { id: roomId },
          body: { email },
        }),
      "Failed to create room invitation",
    );
  }

  async function revokeChatRoomInvitation(
    roomId: string,
    invitationId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdInvitationsByInvitationId({
          client,
          path: { id: roomId, invitationId },
        }),
      "Failed to revoke room invitation",
    );
  }

  /** Host: list shareable guest invite links for an external channel. */
  async function listChatRoomGuestInviteLinks(roomId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdInviteLinks({
          client,
          path: { id: roomId },
          cache: "no-store",
        }),
      "Failed to fetch room invite links",
    );
  }

  /**
   * Host: mint a shareable guest invite link for an external channel.
   * Returns absolute `/chat/join/{token}` URL from Core.
   */
  async function createChatRoomGuestInviteLink(
    roomId: string,
    body: NonNullable<PostChatsRoomsByIdInviteLinksData["body"]> = {},
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdInviteLinks({
          client,
          path: { id: roomId },
          body,
        }),
      "Failed to create room invite link",
    );
  }

  /** Host: revoke a shareable guest invite link by token. */
  async function revokeChatRoomGuestInviteLink(roomId: string, token: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdInviteLinksByToken({
          client,
          path: { id: roomId, token },
        }),
      "Failed to revoke room invite link",
    );
  }

  /**
   * Resolves a shareable room guest invite-link token for `/chat/join` preview.
   * Public: status + room preview only when live.
   */
  async function resolveChatRoomGuestInviteLink(token: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatRoomInviteLinksByToken({
          client,
          path: { token },
          cache: "no-store",
        }),
      "Failed to resolve room invite link",
    );
  }

  /**
   * Accepts a shareable room guest invite link for the signed-in user
   * (`access=guest`). Idempotent when already a guest.
   */
  async function acceptChatRoomGuestInviteLink(token: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatRoomInviteLinksByTokenAccept({
          client,
          path: { token },
        }),
      "Failed to accept room invite link",
    );
  }

  async function getDiscoverableChatRooms(
    query?: GetChatsRoomsDiscoverableData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsDiscoverable({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch discoverable chat rooms",
    );
  }

  async function getChannelSlugAvailability(
    query: NonNullable<GetChatsRoomsChannelSlugAvailabilityData["query"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsChannelSlugAvailability({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to check Channel slug availability",
    );
  }

  /**
   * Creates a chat room. A `direct` room is create-or-get: Core returns the
   * existing room for the same participant set instead of a duplicate
   * (200 found, 201 created).
   */
  async function createChatRoom(
    body: CreateChatRoomRequest & NonNullable<PostChatsRoomsData["body"]>,
  ) {
    return executeCoreOperationWithResponse(
      getClient,
      (client) =>
        corePostChatsRooms({
          client,
          body,
        }),
      "Failed to create chat room",
    );
  }

  async function getChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch chat room",
    );
  }

  async function updateChatRoom(
    id: string,
    body: NonNullable<PatchChatsRoomsByIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchChatsRoomsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update chat room",
    );
  }

  async function archiveChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdArchive({
          client,
          path: { id },
        }),
      "Failed to archive chat room",
    );
  }

  async function restoreChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdRestore({
          client,
          path: { id },
        }),
      "Failed to restore chat room",
    );
  }

  async function deleteChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsById({
          client,
          path: { id },
        }),
      "Failed to permanently delete chat room",
    );
  }

  async function leaveChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMembersMe({
          client,
          path: { id },
        }),
      "Failed to leave chat room",
    );
  }

  async function addChatRoomMembers(
    roomId: string,
    body: NonNullable<PostChatsRoomsByIdMembersData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMembers({
          client,
          path: { id: roomId },
          body,
        }),
      "Failed to add room members",
    );
  }

  /** Remove a person from a Channel: a guest, or (owner/admin) a host member. */
  async function removeChatRoomMember(roomId: string, userId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMembersByUserId({
          client,
          path: { id: roomId, userId },
        }),
      "Failed to remove room member",
    );
  }

  async function removeChatRoomCoworker(roomId: string, coworkerId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdCoworkersByCoworkerId({
          client,
          path: { id: roomId, coworkerId },
        }),
      "Failed to remove room coworker",
    );
  }

  async function removeChatRoomSokoBot(roomId: string, sokoBotId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdSokoBotsBySokoBotId({
          client,
          path: { id: roomId, sokoBotId },
        }),
      "Failed to remove room Soko Bot",
    );
  }

  async function joinChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMembersMe({
          client,
          path: { id },
        }),
      "Failed to join chat room",
    );
  }

  async function markChatRoomRead(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdRead({
          client,
          path: { id },
        }),
      "Failed to mark chat room read",
    );
  }

  async function pinChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdStar({
          client,
          path: { id },
        }),
      "Failed to pin chat room",
    );
  }

  async function unpinChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdStar({
          client,
          path: { id },
        }),
      "Failed to unpin chat room",
    );
  }

  async function reorderPinnedChatRooms(roomIds: string[]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutChatsRoomsStarred({
          client,
          body: { roomIds },
        }),
      "Failed to reorder pinned chat rooms",
    );
  }

  async function muteChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMute({
          client,
          path: { id },
        }),
      "Failed to mute chat room",
    );
  }

  async function unmuteChatRoom(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMute({
          client,
          path: { id },
        }),
      "Failed to unmute chat room",
    );
  }

  async function markChatRoomUnread(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdUnread({
          client,
          path: { id },
        }),
      "Failed to mark chat room unread",
    );
  }

  async function getChatRoomMessages(
    id: string,
    query?: GetChatsRoomsByIdMessagesData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdMessages({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch chat room messages",
    );
  }

  async function getChatRoomPinnedMessages(
    id: string,
    query?: GetChatsRoomsByIdPinnedMessagesData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdPinnedMessages({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch pinned messages",
    );
  }

  async function getChatNeedsYou() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetChatsSignalsNeedsYou({ client, cache: "no-store" }),
      "Failed to fetch messages that need you",
    );
  }

  async function getChatOpenLoops() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetChatsSignalsOpenLoops({ client, cache: "no-store" }),
      "Failed to fetch open loops",
    );
  }

  async function getChatCatchUpSummary(roomId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsSignalsSummary({
          client,
          query: roomId ? { roomId } : undefined,
          cache: "no-store",
        }),
      "Failed to fetch the catch-up summary",
    );
  }

  async function getChatRoomCatchUp(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsSignalsRoomsByIdCatchUp({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch the room catch-up",
    );
  }

  async function getChatRoomDecisions(
    id: string,
    query?: GetChatsSignalsRoomsByIdDecisionsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsSignalsRoomsByIdDecisions({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch decisions",
    );
  }

  async function correctChatMessageSignal(
    messageId: string,
    body: PutChatsSignalsMessagesByMessageIdCorrectionsData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutChatsSignalsMessagesByMessageIdCorrections({
          client,
          path: { messageId },
          body,
        }),
      "Failed to correct the message tag",
    );
  }

  async function setChatMessageSignalLoop(
    messageId: string,
    body: PutChatsSignalsMessagesByMessageIdLoopData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutChatsSignalsMessagesByMessageIdLoop({
          client,
          path: { messageId },
          body,
        }),
      "Failed to update the open loop",
    );
  }

  async function getChatMessageRoutingSuggestions(messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsSignalsMessagesByMessageIdRouting({
          client,
          path: { messageId },
          cache: "no-store",
        }),
      "Failed to fetch routing suggestions",
    );
  }

  async function pinChatRoomMessage(roomId: string, messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessagesByMessageIdPin({
          client,
          path: { id: roomId, messageId },
        }),
      "Failed to pin message",
    );
  }

  async function sendChatRoomMessageToSelf(roomId: string, messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessagesByMessageIdSendToSelf({
          client,
          path: { id: roomId, messageId },
        }),
      "Failed to send message to yourself",
    );
  }

  async function unpinChatRoomMessage(roomId: string, messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMessagesByMessageIdPin({
          client,
          path: { id: roomId, messageId },
        }),
      "Failed to unpin message",
    );
  }

  async function getChatRoomThreads(
    id: string,
    query?: GetChatsRoomsByIdThreadsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdThreads({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch threads",
    );
  }

  async function getChatRoomThreadsUnreadCount(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdThreadsUnreadCount({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch unread thread count",
    );
  }

  async function getChatUnreadThreads(
    query?: GetChatsThreadsUnreadData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsThreadsUnread({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch unread threads",
    );
  }

  async function getChatEarlierThreads(
    query?: GetChatsThreadsEarlierData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsThreadsEarlier({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch earlier threads",
    );
  }

  async function getChatRoomMessageResults(id: string, messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatRoomMessageResults({
          client,
          path: { id, messageId },
          cache: "no-store",
        }),
      "Failed to fetch message results",
    );
  }
  async function getChatRoomMessageResultsBatch(
    id: string,
    messageIds: string[],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatRoomMessageResultsBatch({
          client,
          path: { id },
          query: { messageIds: messageIds.join(",") },
          cache: "no-store",
        }),
      "Failed to fetch message results",
    );
  }
  async function getChatRoomMessage(id: string, messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdMessagesByMessageId({
          client,
          path: { id, messageId },
          cache: "no-store",
        }),
      "Failed to fetch message",
    );
  }

  async function getChatRoomThread(id: string, parentMessageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdThreadsByParentMessageId({
          client,
          path: { id, parentMessageId },
          cache: "no-store",
        }),
      "Failed to fetch thread",
    );
  }

  async function getChatRoomThreadMessages(
    id: string,
    parentMessageId: string,
    query?: GetChatsRoomsByIdThreadsByParentMessageIdMessagesData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdThreadsByParentMessageIdMessages({
          client,
          path: { id, parentMessageId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch thread messages",
    );
  }

  async function markChatRoomThreadRead(id: string, parentMessageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdThreadsByParentMessageIdRead({
          client,
          path: { id, parentMessageId },
        }),
      "Failed to mark thread looked",
    );
  }

  async function muteChatRoomThread(id: string, parentMessageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdThreadsByParentMessageIdMute({
          client,
          path: { id, parentMessageId },
        }),
      "Failed to mute thread",
    );
  }

  async function unmuteChatRoomThread(id: string, parentMessageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdThreadsByParentMessageIdMute({
          client,
          path: { id, parentMessageId },
        }),
      "Failed to unmute thread",
    );
  }

  async function markChatRoomThreadsRead(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdThreadsRead({
          client,
          path: { id },
        }),
      "Failed to mark unread threads looked",
    );
  }

  async function addChatRoomMessage(
    id: string,
    body: CreateChatRoomMessageRequest &
      NonNullable<PostChatsRoomsByIdMessagesData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessages({
          client,
          path: { id },
          body,
        }),
      "Failed to add chat room message",
    );
  }

  async function addChatRoomMessageReaction(
    roomId: string,
    messageId: string,
    emoji: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutChatsRoomsByIdMessagesByMessageIdReactionsByEmoji({
          client,
          path: { id: roomId, messageId, emoji },
        }),
      "Failed to add chat room message reaction",
    );
  }

  async function removeChatRoomMessageReaction(
    roomId: string,
    messageId: string,
    emoji: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMessagesByMessageIdReactionsByEmoji({
          client,
          path: { id: roomId, messageId, emoji },
        }),
      "Failed to remove chat room message reaction",
    );
  }

  async function removeChatRoomMessageUnfurl(
    id: string,
    messageId: string,
    body: NonNullable<
      PostChatsRoomsByIdMessagesByMessageIdUnfurlsRemoveData["body"]
    >,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessagesByMessageIdUnfurlsRemove({
          client,
          path: { id, messageId },
          body,
        }),
      "Failed to remove chat room message unfurl",
    );
  }

  async function retryChatRoomMention(
    id: string,
    messageId: string,
    mentionId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessagesByMessageIdMentionsByMentionIdRetry({
          client,
          path: { id, messageId, mentionId },
        }),
      "Failed to retry chat room mention",
    );
  }

  async function deleteChatRoomMessage(id: string, messageId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMessagesByMessageId({
          client,
          path: { id, messageId },
        }),
      "Failed to delete chat room message",
    );
  }

  async function updateChatRoomMessage(
    id: string,
    messageId: string,
    body: NonNullable<PatchChatsRoomsByIdMessagesByMessageIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchChatsRoomsByIdMessagesByMessageId({
          client,
          path: { id, messageId },
          body,
        }),
      "Failed to update chat room message",
    );
  }

  async function getTasks(query?: GetTasksData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasks({
          client,
          query,
          cache: "no-store",
          responseTransformer: async (data) =>
            transformTaskListResponseEnvelope(data),
        }),
      "Failed to fetch tasks",
    );
  }

  async function getTasksSummary(query?: GetTasksSummaryData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksSummary({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch task summary",
    );
  }

  async function getHistory(query?: GetHistoryData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetHistory({
          client,
          query,
          cache: "no-store",
          responseTransformer: async (data) =>
            transformHistoryResponseEnvelope(data),
        }),
      "Failed to fetch history",
    );
  }

  async function getTransactions(query?: GetTransactionsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTransactions({
          client,
          query,
          cache: "no-store",
          responseTransformer: async (data) =>
            transformTransactionsResponseEnvelope(data),
        }),
      "Failed to fetch transactions",
    );
  }

  async function getTransactionsDaily(
    query?: GetTransactionsDailyData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTransactionsDaily({ client, query, cache: "no-store" }),
      "Failed to fetch daily transactions",
    );
  }

  async function getNotifications(query?: GetNotificationsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetNotifications({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch notifications",
    );
  }

  async function getNotificationsCounts() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetNotificationsCounts({
          client,
          cache: "no-store",
        }),
      "Failed to fetch notification counts",
    );
  }

  async function patchNotificationRead(
    path: PatchNotificationsByIdReadData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchNotificationsByIdRead({
          client,
          path,
          cache: "no-store",
        }),
      "Failed to mark notification as read",
    );
  }

  async function patchNotificationsReadAll() {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchNotificationsReadAll({
          client,
          cache: "no-store",
        }),
      "Failed to mark all notifications as read",
    );
  }

  async function getTaskById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksById({
          client,
          path: { id },
          cache: "no-store",
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to fetch task",
    );
  }

  async function getTaskEvents(
    id: string,
    query?: GetTasksByIdEventsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksByIdEvents({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch task events",
    );
  }

  async function getTaskWorkspace(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksByIdWorkspace({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to resolve task workspace",
    );
  }

  async function getJobs(query?: GetJobsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetJobs({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch jobs",
    );
  }

  async function listAdminInvoices(query: {
    status?:
      | "unfinished"
      | "all"
      | "draft"
      | "open"
      | "paid"
      | "uncollectible"
      | "void";
    recipientType?: "user" | "organization";
    recipientId?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminInvoices({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list admin invoices",
    );
  }

  async function createAdminInvoice(body: {
    targetType: "user" | "organization";
    targetId: string;
    credits: number;
    ttlDays: number | null;
    priceId: string | null;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCreateAdminInvoice({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create admin invoice",
    );
  }

  async function createAdminFreeCreditGrant(body: {
    targetType: "user" | "organization";
    targetId: string;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCreateAdminFreeCreditGrant({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to grant free credits",
    );
  }

  async function getAdminInvoice(invoiceId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminInvoice({
          client,
          path: { id: invoiceId },
          cache: "no-store",
        }),
      "Failed to fetch admin invoice",
    );
  }

  async function markAdminInvoicePaid(invoiceId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreMarkAdminInvoicePaid({
          client,
          path: { id: invoiceId },
          cache: "no-store",
        }),
      "Failed to mark admin invoice paid",
    );
  }

  async function deleteAdminInvoice(invoiceId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteAdminInvoice({
          client,
          path: { id: invoiceId },
          cache: "no-store",
        }),
      "Failed to delete admin invoice",
    );
  }

  async function listCreditPrices() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListCreditPrices({
          client,
          cache: "no-store",
        }),
      "Failed to list credit prices",
    );
  }

  async function getCreditTopUpPriceCatalog() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCreditTopUpPriceCatalog({
          client,
          cache: "no-store",
        }),
      "Failed to fetch credit top-up price catalog",
    );
  }

  async function getSubscriptionCatalog() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetSubscriptionCatalog({
          client,
          cache: "no-store",
        }),
      "Failed to fetch subscription catalog",
    );
  }

  async function createCreditCheckoutSession(body: {
    organizationId?: string | null;
    credits: number;
    returnPath?: string;
    promotionCodeId?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCreateCreditCheckoutSession({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create credit checkout session",
    );
  }

  async function getCheckoutSessionAnalytics(sessionId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCheckoutSessionAnalytics({
          client,
          path: { sessionId },
          cache: "no-store",
        }),
      "Failed to fetch checkout session analytics",
    );
  }

  async function getCouponDetails(couponId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCouponDetails({
          client,
          path: { couponId },
          cache: "no-store",
        }),
      "Failed to fetch coupon details",
    );
  }

  async function claimCoupon(
    couponId: string,
    body: { organizationId?: string | null } = {},
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreClaimCoupon({
          client,
          path: { couponId },
          body,
          cache: "no-store",
        }),
      "Failed to claim coupon",
    );
  }

  async function listAdminUsers(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminUsers({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list users",
    );
  }

  /**
   * Fetches a user by id (admins may read any user), returning null when no
   * user matches (Core responds 404).
   */
  async function getUserById(userId: string) {
    const result = await executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersById({ client, path: { id: userId }, cache: "no-store" }),
      "Failed to fetch user",
    ).catch(nullWhenNotFound);
    return result ? result.data : null;
  }

  /**
   * Fetches how the user signed up (sign-up origin and context), returning
   * null when Core has no record for the user (Core responds 404: accounts
   * created before sign-ups were recorded).
   */
  async function getUserSignUp(userId: string) {
    const result = await executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdSignUp({
          client,
          path: { id: userId },
          cache: "no-store",
        }),
      "Failed to fetch user sign-up",
    ).catch(nullWhenNotFound);
    return result ? result.data : null;
  }

  async function startAdminImpersonation(body: {
    userId: string;
    reason: string;
  }) {
    return executeCoreOperationWithResponse(
      getClient,
      (client) =>
        coreStartAdminImpersonation({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to start impersonation",
    );
  }

  async function stopAdminImpersonation() {
    return executeCoreOperationWithResponse(
      getClient,
      (client) =>
        coreStopAdminImpersonation({
          client,
          cache: "no-store",
        }),
      "Failed to stop impersonation",
    );
  }

  async function listAdminAgents(query: {
    q?: string;
    cursor?: string;
    limit?: number;
    status?: AgentStatus;
    sortBy?:
      | "displayName"
      | "registryName"
      | "hasOverride"
      | "status"
      | "createdAt";
    sortOrder?: "asc" | "desc";
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminAgents({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list agents",
    );
  }

  async function getAdminAgent(agentId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminAgent({
          client,
          path: { id: agentId },
          cache: "no-store",
        }),
      "Failed to fetch admin agent",
    );
  }

  async function patchAdminAgentMetadataOverride(
    agentId: string,
    body: Parameters<typeof corePatchAdminAgentMetadataOverride>[0]["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchAdminAgentMetadataOverride({
          client,
          path: { id: agentId },
          body,
          cache: "no-store",
        }),
      "Failed to update agent metadata override",
    );
  }

  async function deleteAdminAgentMetadataOverride(agentId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteAdminAgentMetadataOverride({
          client,
          path: { id: agentId },
          cache: "no-store",
        }),
      "Failed to delete agent metadata override",
    );
  }

  async function listAdminTasks(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminTasks({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list tasks",
    );
  }

  async function getAdminTask(taskId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminTask({
          client,
          path: { id: taskId },
          cache: "no-store",
        }),
      "Failed to fetch admin task",
    );
  }

  async function listAdminTaskX402Payments(
    query: NonNullable<ListAdminTaskX402PaymentsData["query"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminTaskX402Payments({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list task x402 payments",
    );
  }

  async function aggregateAdminTaskX402Payments(
    query: NonNullable<AggregateAdminTaskX402PaymentsByAgentData["query"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreAggregateAdminTaskX402PaymentsByAgent({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to aggregate task x402 payments",
    );
  }

  async function refundAdminTaskX402Payment(
    paymentId: RefundAdminTaskX402PaymentData["path"]["id"],
    reason: RefundAdminTaskX402PaymentData["body"]["reason"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreRefundAdminTaskX402Payment({
          client,
          path: { id: paymentId },
          body: { reason },
          cache: "no-store",
        }),
      "Failed to refund task x402 payment",
    );
  }

  async function resolveAdminTaskX402Payment(
    paymentId: ResolveAdminTaskX402PaymentData["path"]["id"],
    reason: ResolveAdminTaskX402PaymentData["body"]["reason"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreResolveAdminTaskX402Payment({
          client,
          path: { id: paymentId },
          body: { reason },
          cache: "no-store",
        }),
      "Failed to resolve task x402 payment",
    );
  }

  async function listDeveloperOwnedCoworkerTasks(query: {
    coworkerId?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListDeveloperOwnedCoworkerTasks({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list developer tasks",
    );
  }

  async function getDeveloperOwnedCoworkerTask(taskId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetDeveloperOwnedCoworkerTask({
          client,
          path: { id: taskId },
          cache: "no-store",
        }),
      "Failed to fetch developer task",
    );
  }

  async function searchAdminUsers(query: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreSearchAdminUsers({
          client,
          query: { query },
          cache: "no-store",
        }),
      "Failed to search users",
    );
  }

  async function searchAdminOrganizations(query: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreSearchAdminOrganizations({
          client,
          query: { query },
          cache: "no-store",
        }),
      "Failed to search organizations",
    );
  }

  async function getAdminOrganizationBySlug(slug: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminOrganizationBySlug({
          client,
          path: { slug },
          cache: "no-store",
        }),
      "Failed to fetch organization overview",
    );
  }

  async function listAdminOrganizations(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminOrganizations({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list organizations",
    );
  }

  async function listAdminOrganizationMembers(
    slug: string,
    query: { cursor?: string; limit?: number },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminOrganizationMembers({
          client,
          path: { slug },
          query,
          cache: "no-store",
        }),
      "Failed to list organization members",
    );
  }

  async function listAdminMatchedChannels(query?: {
    status?: "active" | "archived";
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminMatchedChannels({
          client,
          ...(query ? { query } : {}),
          cache: "no-store",
        }),
      "Failed to list matched channels",
    );
  }

  async function createAdminMatchedChannel(body: {
    name?: string;
    slug: string;
    topic?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCreateAdminMatchedChannel({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create matched channel",
    );
  }

  async function getAdminMatchedChannel(roomId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminMatchedChannel({
          client,
          path: { roomId },
          cache: "no-store",
        }),
      "Failed to fetch matched channel",
    );
  }

  async function addAdminMatchedChannelParticipant(
    roomId: string,
    body: { userId: string },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreAddAdminMatchedChannelParticipant({
          client,
          path: { roomId },
          body,
          cache: "no-store",
        }),
      "Failed to add matched channel participant",
    );
  }

  async function addAdminMatchedChannelParticipantsFromOrganization(
    roomId: string,
    body: { organizationId?: string; organizationSlug?: string },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreAddAdminMatchedChannelParticipantsFromOrganization({
          client,
          path: { roomId },
          body,
          cache: "no-store",
        }),
      "Failed to add matched channel participants from organization",
    );
  }

  async function removeAdminMatchedChannelParticipant(
    roomId: string,
    userId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreRemoveAdminMatchedChannelParticipant({
          client,
          path: { roomId, userId },
          cache: "no-store",
        }),
      "Failed to remove matched channel participant",
    );
  }

  async function archiveAdminMatchedChannel(roomId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreArchiveAdminMatchedChannel({
          client,
          path: { roomId },
          cache: "no-store",
        }),
      "Failed to archive matched channel",
    );
  }

  async function restoreAdminMatchedChannel(roomId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreRestoreAdminMatchedChannel({
          client,
          path: { roomId },
          cache: "no-store",
        }),
      "Failed to restore matched channel",
    );
  }

  async function deleteAdminMatchedChannel(roomId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteAdminMatchedChannel({
          client,
          path: { roomId },
          cache: "no-store",
        }),
      "Failed to permanently delete matched channel",
    );
  }

  async function addAdminOrganizationMember(
    slug: string,
    body: { userId: string; role: "owner" | "admin" | "member" },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreAddAdminOrganizationMember({
          client,
          path: { slug },
          body,
          cache: "no-store",
        }),
      "Failed to add organization member",
    );
  }

  async function removeAdminOrganizationMember(slug: string, memberId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreRemoveAdminOrganizationMember({
          client,
          path: { slug, memberId },
          cache: "no-store",
        }),
      "Failed to remove organization member",
    );
  }

  async function updateAdminOrganizationMemberRole(
    slug: string,
    memberId: string,
    body: { role: "owner" | "admin" | "member" },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreUpdateAdminOrganizationMemberRole({
          client,
          path: { slug, memberId },
          body,
          cache: "no-store",
        }),
      "Failed to update organization member role",
    );
  }

  async function assignAdminOrganizationMemberSeat(
    slug: string,
    memberId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreAssignAdminOrganizationMemberSeat({
          client,
          path: { slug, memberId },
          cache: "no-store",
        }),
      "Failed to assign organization seat",
    );
  }

  async function unassignAdminOrganizationMemberSeat(
    slug: string,
    memberId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreUnassignAdminOrganizationMemberSeat({
          client,
          path: { slug, memberId },
          cache: "no-store",
        }),
      "Failed to unassign organization seat",
    );
  }

  async function getOrganizationEnterpriseContractSummary(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationEnterpriseContractSummary({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch enterprise contract summary",
    );
  }

  async function getJobById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetJobsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch job",
    );
  }

  async function pinProject(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdStar({
          client,
          path: { id },
        }),
      "Failed to pin project",
    );
  }

  async function unpinProject(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdStar({
          client,
          path: { id },
        }),
      "Failed to unpin project",
    );
  }

  async function getPinnedProjects() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsStarred({
          client,
          cache: "no-store",
        }),
      "Failed to fetch pinned projects",
    );
  }

  async function getProjects(query?: GetProjectsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjects({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch projects",
    );
  }

  async function getProjectsStats(query?: GetProjectsStatsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsStats({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch project stats",
    );
  }

  async function postProjects(body: NonNullable<PostProjectsData["body"]>) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjects({
          client,
          body,
        }),
      "Failed to create project",
    );
  }

  async function getOrganizationMembers(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdMembers({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization members",
    );
  }

  async function getOrganizationPendingInvitations(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdInvitations({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization invitations",
    );
  }

  async function getOrganizationInviteLinks(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdInviteLinks({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization invite links",
    );
  }

  async function getOrganizationVendorGrants(
    organizationId: string,
    query?: {
      status?: "PENDING" | "GRANTED" | "DENIED" | "REVOKED";
      vendorId?: string;
    },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdVendorGrants({
          client,
          path: { id: organizationId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch vendor grants",
    );
  }

  async function createOrganizationVendorGrant(
    organizationId: string,
    body: {
      vendorId: string;
    },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrants({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to create vendor grant",
    );
  }

  async function approveOrganizationVendorGrant(
    organizationId: string,
    grantId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrantsByGrantIdApprove({
          client,
          path: { id: organizationId, grantId },
        }),
      "Failed to approve vendor grant",
    );
  }

  async function denyOrganizationVendorGrant(
    organizationId: string,
    grantId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrantsByGrantIdDeny({
          client,
          path: { id: organizationId, grantId },
        }),
      "Failed to deny vendor grant",
    );
  }

  async function revokeOrganizationVendorGrant(
    organizationId: string,
    grantId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrantsByGrantIdRevoke({
          client,
          path: { id: organizationId, grantId },
        }),
      "Failed to revoke vendor grant",
    );
  }

  async function getMyVendorGrants(query?: {
    status?: "PENDING" | "GRANTED" | "DENIED" | "REVOKED";
    vendorId?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdVendorGrants({
          client,
          path: { id: "me" },
          query,
          cache: "no-store",
        }),
      "Failed to fetch personal vendor grants",
    );
  }

  async function createMyVendorGrant(body: { vendorId: string }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrants({
          client,
          path: { id: "me" },
          body,
        }),
      "Failed to create personal vendor grant",
    );
  }

  async function approveMyVendorGrant(grantId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrantsByGrantIdApprove({
          client,
          path: { id: "me", grantId },
        }),
      "Failed to approve personal vendor grant",
    );
  }

  async function denyMyVendorGrant(grantId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrantsByGrantIdDeny({
          client,
          path: { id: "me", grantId },
        }),
      "Failed to deny personal vendor grant",
    );
  }

  async function revokeMyVendorGrant(grantId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrantsByGrantIdRevoke({
          client,
          path: { id: "me", grantId },
        }),
      "Failed to revoke personal vendor grant",
    );
  }

  async function getMyCoworkerAccess() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdCoworkerAccess({
          client,
          path: { id: "me" },
          cache: "no-store",
        }),
      "Failed to fetch personal coworker access",
    );
  }

  async function approveMyCoworkerAccess(accessId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdCoworkerAccessByAccessIdApprove({
          client,
          path: { id: "me", accessId },
        }),
      "Failed to approve personal coworker access",
    );
  }

  async function denyMyCoworkerAccess(accessId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdCoworkerAccessByAccessIdDeny({
          client,
          path: { id: "me", accessId },
        }),
      "Failed to deny personal coworker access",
    );
  }

  async function revokeMyCoworkerAccess(accessId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdCoworkerAccessByAccessIdRevoke({
          client,
          path: { id: "me", accessId },
        }),
      "Failed to revoke personal coworker access",
    );
  }

  async function getOrganizationCoworkerAccess(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdCoworkerAccess({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization coworker access",
    );
  }

  async function approveOrganizationCoworkerAccess(
    organizationId: string,
    accessId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdCoworkerAccessByAccessIdApprove({
          client,
          path: { id: organizationId, accessId },
        }),
      "Failed to approve organization coworker access",
    );
  }

  async function denyOrganizationCoworkerAccess(
    organizationId: string,
    accessId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdCoworkerAccessByAccessIdDeny({
          client,
          path: { id: organizationId, accessId },
        }),
      "Failed to deny organization coworker access",
    );
  }

  async function revokeOrganizationCoworkerAccess(
    organizationId: string,
    accessId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdCoworkerAccessByAccessIdRevoke({
          client,
          path: { id: organizationId, accessId },
        }),
      "Failed to revoke organization coworker access",
    );
  }

  async function listCoworkerWorkspaceAccess(coworkerId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListCoworkerWorkspaceAccess({
          client,
          path: { id: coworkerId },
          cache: "no-store",
        }),
      "Failed to list coworker workspace access",
    );
  }

  async function createCoworkerWorkspaceAccess(
    coworkerId: string,
    body: {
      workspaceId?: string;
      userId?: string;
      organizationId?: string;
      email?: string;
      organizationSlug?: string;
    },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCreateCoworkerWorkspaceAccess({
          client,
          path: { id: coworkerId },
          body,
        }),
      "Failed to create coworker workspace access",
    );
  }

  async function revokeCoworkerWorkspaceAccessAsPlatformAdmin(
    coworkerId: string,
    body: {
      workspaceId?: string;
      userId?: string;
      organizationId?: string;
      email?: string;
      organizationSlug?: string;
    },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreRevokeCoworkerWorkspaceAccessAsPlatformAdmin({
          client,
          path: { id: coworkerId },
          body,
        }),
      "Failed to revoke coworker workspace access",
    );
  }

  /**
   * Seat usage summary for an organization the caller is a member of:
   * assigned and purchased seat counts alongside the resolved paid plan.
   */
  async function getOrganizationSeatSummary(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdSeatSummary({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization seat summary",
    );
  }

  /**
   * Assigns a seat to an organization member. Core enforces that the caller
   * is an organization owner or admin and runs the assignment, capacity
   * check, and resulting credit grants (with per-seat amounts resolved from
   * the Stripe subscription catalog) in a single transaction.
   */
  async function assignOrganizationSeat(
    organizationId: string,
    memberId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutOrganizationsByIdMembersByMemberIdSeat({
          client,
          path: { id: organizationId, memberId },
        }),
      "Failed to assign organization seat",
    );
  }

  /**
   * Unassigns an organization member's seat. Core enforces that the caller is
   * an organization owner or admin and runs the unassignment and resulting
   * credit grants in a single transaction.
   */
  async function unassignOrganizationSeat(
    organizationId: string,
    memberId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteOrganizationsByIdMembersByMemberIdSeat({
          client,
          path: { id: organizationId, memberId },
        }),
      "Failed to unassign organization seat",
    );
  }

  /**
   * Immediately updates the purchased seat count on an organization's active
   * subscription. Core enforces that the caller is an organization owner or
   * admin, blocks self-serve changes while an enterprise contract is active,
   * and requires at least 1 purchased seat. Stripe-backed subscriptions are
   * invoiced for the change right away.
   */
  async function updateOrganizationSubscriptionSeats(
    organizationId: string,
    seats: number,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutOrganizationsByIdSubscriptionSeats({
          client,
          path: { id: organizationId },
          body: { seats },
        }),
      "Failed to update organization subscription seats",
    );
  }

  async function getInvitationById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetInvitationsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch invitation",
    );
  }

  async function getOrganizationStripeCustomer(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdStripeCustomer({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization Stripe customer",
    );
  }

  /**
   * Ensures a Stripe customer exists for an organization (any-member):
   * returns the existing customer id or creates the Stripe customer and
   * returns the new id. Local persistence happens via the Stripe
   * `customer.created` webhook.
   */
  async function createOrganizationStripeCustomer(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdStripeCustomer({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to create organization Stripe customer",
    );
  }

  async function getOrganizationBillingDetails(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdBillingDetails({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization billing details",
    );
  }

  async function getOrganizationBillingPlan(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdBillingPlan({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization billing plan",
    );
  }

  async function getOrganizationCallerSeat(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdMembersMeSeat({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization caller seat",
    );
  }

  async function getOrganizationActiveSubscription(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdSubscription({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization subscription",
    );
  }

  async function getMyActiveSubscription() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdSubscription({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user subscription",
    );
  }

  async function getMyDeletion() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdDeletion({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch account deletion blockers",
    );
  }

  async function getOrganizationDeletion(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdDeletion({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization deletion blockers",
    );
  }

  async function getMyOrganizationCredits(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdOrganizationsByOrganizationIdCredits({
          client,
          path: { id: CURRENT_USER_PATH_ID, organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization credits",
    );
  }

  async function getMyStripeCustomer() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdStripeCustomer({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user Stripe customer",
    );
  }

  /**
   * Ensures a Stripe customer exists for the current user: returns the
   * existing customer id or creates the Stripe customer and returns the new
   * id. Local persistence happens via the Stripe `customer.created` webhook.
   */
  async function createMyStripeCustomer() {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdStripeCustomer({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to create user Stripe customer",
    );
  }

  /**
   * Creates a workspace for the current user and makes it preferred
   * (ADR 0051). A personal workspace is created once (409 when it exists);
   * an organization takes a name and website (403 at the organization limit).
   */
  async function createMyWorkspace(body: CreateUserWorkspace) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdWorkspaces({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
          cache: "no-store",
        }),
      "Failed to create workspace",
    );
  }

  /**
   * Deletes the current user's personal workspace, by workspace id from
   * {@link getMyWorkspaces}. Core returns 409 for an organization workspace,
   * the last workspace, or one that jobs or tasks still reference.
   */
  async function deleteMyWorkspace(workspaceId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteUsersByIdWorkspacesByWorkspaceId({
          client,
          path: { id: CURRENT_USER_PATH_ID, workspaceId },
          cache: "no-store",
        }),
      "Failed to delete personal workspace",
    );
  }

  async function getMyBillingDetails() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdBillingDetails({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user billing details",
    );
  }

  async function getUserBillingDetails(userId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdBillingDetails({
          client,
          path: { id: userId },
          cache: "no-store",
        }),
      "Failed to fetch user billing details",
    );
  }

  /**
   * Revokes the current user's OAuth consent: Core deletes the consent,
   * revokes the client's refresh tokens, and deletes its access tokens in a
   * single transaction.
   */
  async function revokeMyOauthConsent(consentId: string, clientId: string) {
    await executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteUsersByIdOauthConsentsByConsentId({
          client,
          path: { id: CURRENT_USER_PATH_ID, consentId },
          query: { clientId },
        }),
      "Failed to revoke OAuth client access",
    );
  }

  async function getProjectsById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch project",
    );
  }

  async function getProjectsByIdCalendar(
    id: string,
    query: GetProjectsByIdCalendarData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdCalendar({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch project calendar",
    );
  }

  async function getProjectsByIdClose(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdClose({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch project close status",
    );
  }

  async function getProjectsByIdContextMd(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdContextMd({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch project memory",
    );
  }

  async function getProjectsByIdNeedsAttention(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdNeedsAttention({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch project needs-attention",
    );
  }

  async function getProjectsByIdSocialConnections(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialConnections({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch Project social connections",
    );
  }

  /**
   * The studio's model catalog, which is global rather than project-scoped.
   *
   * Its own route because it is ~158KB and the studio polls its *state* every
   * three seconds; the catalog used to ride along on that payload. Core sets
   * `private, max-age=300`, and the read is authenticated, so this stays on the
   * session client rather than moving to `coreCatalogClient` — a cookie-free
   * call would be refused.
   */
  async function getImageStudioCatalog() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetImageStudioCatalog({
          client,
          cache: "no-store",
        }),
      "Failed to fetch the image studio catalog",
    );
  }

  /** The studio across every project in the session's workspace. */
  async function getImageStudioState(query?: GetImageStudioStateData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetImageStudioState({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch the workspace image studio",
    );
  }

  async function getProjectsByIdImageStudio(
    id: string,
    query?: GetProjectsByIdImageStudioData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdImageStudio({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch Project image studio",
    );
  }

  async function getProjectsByIdImageStudioAssetsByAssetIdSocialMedia(
    id: string,
    assetId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdImageStudioAssetsByAssetIdSocialMedia({
          client,
          path: { id, assetId },
          cache: "no-store",
        }),
      "Failed to attach this image",
    );
  }

  async function postProjectsByIdImageStudioJobs(
    id: string,
    body: NonNullable<PostProjectsByIdImageStudioJobsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdImageStudioJobs({
          client,
          path: { id },
          body,
        }),
      "Failed to start image generation",
    );
  }

  async function postProjectsByIdImageStudioVideoJobs(
    id: string,
    body: NonNullable<PostProjectsByIdImageStudioVideoJobsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdImageStudioVideoJobs({
          client,
          path: { id },
          body,
        }),
      "Failed to start video generation",
    );
  }

  async function postProjectsByIdImageStudioJobsByJobIdCancel(
    id: string,
    jobId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdImageStudioJobsByJobIdCancel({
          client,
          path: { id, jobId },
        }),
      "Failed to request cancellation",
    );
  }

  async function getProjectsByIdSocialPosts(
    id: string,
    query?: GetProjectsByIdSocialPostsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialPosts({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch Project social posts",
    );
  }

  async function getProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes(
    id: string,
    connectionId: string,
    query: GetProjectsByIdSocialConnectionsByConnectionIdSuggestedTimesData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes({
          client,
          path: { id, connectionId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch suggested posting times",
    );
  }

  async function getProjectsByIdSocialConnectionsStatistics(
    id: string,
    query?: GetProjectsByIdSocialConnectionsStatisticsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialConnectionsStatistics({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch social account statistics",
    );
  }

  async function getProjectsByIdSocialConnectionsByConnectionIdStatisticsAudience(
    id: string,
    connectionId: string,
    query?: GetProjectsByIdSocialConnectionsByConnectionIdStatisticsAudienceData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialConnectionsByConnectionIdStatisticsAudience({
          client,
          path: { id, connectionId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch Social audience",
    );
  }

  async function getProjectsByIdSocialConnectionsByConnectionIdStatisticsBenchmark(
    id: string,
    connectionId: string,
    username: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialConnectionsByConnectionIdStatisticsBenchmark({
          client,
          path: { id, connectionId },
          query: { username },
          cache: "no-store",
        }),
      "Failed to fetch Social benchmark",
    );
  }

  async function getProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscovery(
    id: string,
    connectionId: string,
    query: NonNullable<
      GetProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscoveryData["query"]
    >,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscovery({
          client,
          path: { id, connectionId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch public Social posts",
    );
  }

  async function postProjectsByIdSocialConnectionsByConnectionIdStatisticsRefresh(
    id: string,
    connectionId: string,
    body: NonNullable<
      PostProjectsByIdSocialConnectionsByConnectionIdStatisticsRefreshData["body"]
    >,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialConnectionsByConnectionIdStatisticsRefresh({
          client,
          path: { id, connectionId },
          body,
        }),
      "Failed to refresh social account statistics",
    );
  }

  async function getProjectsByIdSocialPostsStatistics(
    id: string,
    query?: GetProjectsByIdSocialPostsStatisticsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialPostsStatistics({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch Project Social statistics",
    );
  }

  async function postProjectsByIdSocialPostsByPostIdStatisticsRefresh(
    id: string,
    postId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialPostsByPostIdStatisticsRefresh({
          client,
          path: { id, postId },
        }),
      "Failed to refresh Project Social statistics",
    );
  }

  async function getProjectsByIdSocialPostsByPostId(
    id: string,
    postId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdSocialPostsByPostId({
          client,
          path: { id, postId },
          cache: "no-store",
        }),
      "Failed to fetch Project social post",
    );
  }

  async function postProjectsByIdSocialPosts(
    id: string,
    body: NonNullable<PostProjectsByIdSocialPostsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialPosts({
          client,
          path: { id },
          body,
        }),
      "Failed to create Project social post",
    );
  }

  async function patchProjectsByIdSocialPostsByPostId(
    id: string,
    postId: string,
    body: NonNullable<PatchProjectsByIdSocialPostsByPostIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchProjectsByIdSocialPostsByPostId({
          client,
          path: { id, postId },
          body,
        }),
      "Failed to update Project social post",
    );
  }

  async function postProjectsByIdSocialPostsByPostIdSchedule(
    id: string,
    postId: string,
    body: NonNullable<PostProjectsByIdSocialPostsByPostIdScheduleData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialPostsByPostIdSchedule({
          client,
          path: { id, postId },
          body,
        }),
      "Failed to schedule Project social post",
    );
  }

  async function postProjectsByIdSocialPostsByPostIdCancel(
    id: string,
    postId: string,
    body: NonNullable<PostProjectsByIdSocialPostsByPostIdCancelData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialPostsByPostIdCancel({
          client,
          path: { id, postId },
          body,
        }),
      "Failed to cancel Project social post",
    );
  }

  async function postProjectsByIdSocialPostsByPostIdDuplicate(
    id: string,
    postId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialPostsByPostIdDuplicate({
          client,
          path: { id, postId },
        }),
      "Failed to duplicate Project social post",
    );
  }

  async function postProjectsByIdSocialAccountPostsByAccountPostIdRecycle(
    id: string,
    accountPostId: string,
    body: NonNullable<
      PostProjectsByIdSocialAccountPostsByAccountPostIdRecycleData["body"]
    >,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialAccountPostsByAccountPostIdRecycle({
          client,
          path: { id, accountPostId },
          body,
        }),
      "Failed to recycle Performance post",
    );
  }

  async function postProjectsByIdSocialPostsByPostIdPublish(
    id: string,
    postId: string,
    body: NonNullable<PostProjectsByIdSocialPostsByPostIdPublishData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialPostsByPostIdPublish({
          client,
          path: { id, postId },
          body,
        }),
      "Failed to publish Project social post",
    );
  }

  async function completeComposioCallback(
    body: NonNullable<PostComposioCallbackCompleteData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) => corePostComposioCallbackComplete({ client, body }),
      "Failed to verify OAuth callback",
    );
  }

  async function patchProjectsById(
    id: string,
    body: NonNullable<PatchProjectsByIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchProjectsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update project",
    );
  }

  async function putProjectsByIdDesignMd(
    id: string,
    body: NonNullable<PutProjectsByIdDesignMdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutProjectsByIdDesignMd({
          client,
          path: { id },
          body,
        }),
      "Failed to save project DESIGN.md",
    );
  }

  async function deleteProjectsByIdDesignMd(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdDesignMd({
          client,
          path: { id },
        }),
      "Failed to remove project DESIGN.md",
    );
  }

  async function getProjectsByIdAdsAccounts(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsAccounts({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch Project ad accounts",
    );
  }

  async function postProjectsByIdAdsConnectionsInitiate(
    id: string,
    body: PostProjectsByIdAdsConnectionsInitiateData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdAdsConnectionsInitiate({
          client,
          path: { id },
          body,
        }),
      "Failed to initiate Project ad connection",
    );
  }

  async function postProjectsByIdAdsConnectionsFinalize(
    id: string,
    body: PostProjectsByIdAdsConnectionsFinalizeData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdAdsConnectionsFinalize({
          client,
          path: { id },
          body,
        }),
      "Failed to finalize Project ad connection",
    );
  }

  async function postProjectsByIdAdsAccounts(
    id: string,
    body: PostProjectsByIdAdsAccountsData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdAdsAccounts({
          client,
          path: { id },
          body,
        }),
      "Failed to attach Project ad accounts",
    );
  }

  async function deleteProjectsByIdAdsAccountsByAccountId(
    path: DeleteProjectsByIdAdsAccountsByAccountIdData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdAdsAccountsByAccountId({ client, path }),
      "Failed to disconnect Project ad account",
    );
  }

  async function deleteProjectsByIdAdsConnectionsByAdConnectionId(
    path: DeleteProjectsByIdAdsConnectionsByAdConnectionIdData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdAdsConnectionsByAdConnectionId({ client, path }),
      "Failed to discard Project ad connection",
    );
  }

  async function getProjectsByIdAdsAccountsByAccountIdCampaigns(
    path: GetProjectsByIdAdsAccountsByAccountIdCampaignsData["path"],
    query: GetProjectsByIdAdsAccountsByAccountIdCampaignsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsAccountsByAccountIdCampaigns({
          client,
          path,
          query,
          cache: "no-store",
        }),
      "Failed to fetch ad campaigns",
    );
  }

  async function getProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId(
    path: GetProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData["path"],
    query: GetProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId({
          client,
          path,
          query,
          cache: "no-store",
        }),
      "Failed to fetch ad campaign details",
    );
  }

  async function getProjectsByIdAdsAccountsByAccountIdTargetingLocations(
    path: GetProjectsByIdAdsAccountsByAccountIdTargetingLocationsData["path"],
    query: GetProjectsByIdAdsAccountsByAccountIdTargetingLocationsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsAccountsByAccountIdTargetingLocations({
          client,
          path,
          query,
          cache: "no-store",
        }),
      "Failed to look up ad locations",
    );
  }

  async function getProjectsByIdAdsAccountsByAccountIdTargetingLanguages(
    path: GetProjectsByIdAdsAccountsByAccountIdTargetingLanguagesData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsAccountsByAccountIdTargetingLanguages({
          client,
          path,
          cache: "no-store",
        }),
      "Failed to fetch ad languages",
    );
  }

  async function patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId(
    path: PatchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData["path"],
    body: PatchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId({
          client,
          path,
          body,
        }),
      "Failed to update ad campaign",
    );
  }

  async function postProjectsByIdAdsAccountsByAccountIdCampaigns(
    path: PostProjectsByIdAdsAccountsByAccountIdCampaignsData["path"],
    body: PostProjectsByIdAdsAccountsByAccountIdCampaignsData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdAdsAccountsByAccountIdCampaigns({
          client,
          path,
          body,
        }),
      "Failed to create ad campaign",
    );
  }

  async function getProjectsByIdAdsMarket(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsMarket({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch Project ad market",
    );
  }

  async function putProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId(
    path: PutProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData["path"],
    body: PutProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId({
          client,
          path,
          body,
        }),
      "Failed to edit ad campaign",
    );
  }

  async function putProjectsByIdAdsMarket(
    id: string,
    body: PutProjectsByIdAdsMarketData["body"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) => corePutProjectsByIdAdsMarket({ client, path: { id }, body }),
      "Failed to save Project ad market",
    );
  }

  async function getProjectsByIdAdsMarketKeywords(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsMarketKeywords({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch market keywords",
    );
  }

  async function getProjectsByIdAdsMarketAds(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetProjectsByIdAdsMarketAds({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch market ads",
    );
  }

  async function postProjectsByIdSocialConnectionsInitiate(
    id: string,
    body: NonNullable<PostProjectsByIdSocialConnectionsInitiateData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialConnectionsInitiate({
          client,
          path: { id },
          body,
        }),
      "Failed to initiate Project social connection",
    );
  }

  async function postProjectsByIdSocialConnectionsFinalize(
    id: string,
    body: NonNullable<PostProjectsByIdSocialConnectionsFinalizeData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdSocialConnectionsFinalize({
          client,
          path: { id },
          body,
        }),
      "Failed to finalize Project social connection",
    );
  }

  async function deleteProjectsByIdSocialConnectionsByConnectionId(
    path: DeleteProjectsByIdSocialConnectionsByConnectionIdData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdSocialConnectionsByConnectionId({ client, path }),
      "Failed to disconnect Project social connection",
    );
  }

  async function postProjectsByIdClose(
    id: string,
    body: NonNullable<PostProjectsByIdCloseData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdClose({
          client,
          path: { id },
          body,
        }),
      "Failed to close project",
    );
  }

  async function postProjectsByIdCloseRetry(
    id: string,
    body: NonNullable<PostProjectsByIdCloseRetryData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdCloseRetry({
          client,
          path: { id },
          body,
        }),
      "Failed to retry project close",
    );
  }

  async function postProjectsByIdCloseCancelOwed(
    id: string,
    body: NonNullable<PostProjectsByIdCloseCancelOwedData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdCloseCancelOwed({
          client,
          path: { id },
          body,
        }),
      "Failed to cancel owed project work",
    );
  }

  async function postProjectsByIdJobs(
    id: string,
    body: NonNullable<PostProjectsByIdJobsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdJobs({
          client,
          path: { id },
          body,
        }),
      "Failed to add job to project",
    );
  }

  async function deleteProjectsByIdJobsByJobId(
    path: DeleteProjectsByIdJobsByJobIdData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdJobsByJobId({
          client,
          path,
        }),
      "Failed to remove job from project",
    );
  }

  async function postProjectsByIdTasks(
    id: string,
    body: NonNullable<PostProjectsByIdTasksData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostProjectsByIdTasks({
          client,
          path: { id },
          body,
        }),
      "Failed to add task to project",
    );
  }

  async function deleteProjectsByIdTasksByTaskId(
    path: DeleteProjectsByIdTasksByTaskIdData["path"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdTasksByTaskId({
          client,
          path,
        }),
      "Failed to remove task from project",
    );
  }

  async function patchJob(
    id: string,
    body: NonNullable<PatchJobsByIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchJobsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update job",
    );
  }

  async function requestJobRefund(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostJobsByIdRefund({
          client,
          path: { id },
        }),
      "Failed to request job refund",
    );
  }

  async function getAgentById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgentsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch agent",
    );
  }

  async function getAgents(query?: GetAgentsData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgents({
          client,
          query,
          // Catalog sharing lives in `'use cache'` loaders via
          // `coreCatalogClient` — keep this transport `no-store`.
          cache: "no-store",
        }),
      "Failed to fetch agents",
    );
  }

  async function getAgentJobs(
    id: string,
    query?: GetAgentsByIdJobsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdJobs({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch agent jobs",
    );
  }

  async function getAgentReviews(
    id: string,
    query?: GetAgentsByIdReviewsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdReviews({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch agent reviews",
    );
  }

  async function getMyAgentReview(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdReviewsMe({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch your agent review",
    );
  }

  async function getAgentRatingEligibility(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdRatingsEligibility({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch agent rating eligibility",
    );
  }

  async function createAgentRating(
    id: string,
    body: NonNullable<PostAgentsByIdRatingsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostAgentsByIdRatings({
          client,
          path: { id },
          body,
        }),
      "Failed to submit agent rating",
    );
  }

  async function createAgentJob(
    id: string,
    body: NonNullable<PostAgentsByIdJobsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      async (client) => {
        const result = await corePostAgentsByIdJobs({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PostAgentsByIdJobsError,
            response: result.response,
          };
        }

        return result;
      },
      "Failed to create agent job",
    );
  }

  async function getAgentInputSchema(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdInputSchema({
          client,
          path: { id },
        }),
      "Failed to fetch agent input schema",
    );
  }

  async function getCategories(query?: GetCategoriesData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCategories({
          client,
          query,
          // Catalog sharing lives in `'use cache'` loaders via
          // `coreCatalogClient` — keep this transport `no-store`.
          cache: "no-store",
        }),
      "Failed to fetch categories",
    );
  }

  async function listVendors() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListVendors({
          client,
          cache: "no-store",
        }),
      "Failed to fetch vendors",
    );
  }

  async function listAdminBadgeCampaigns() {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminBadgeCampaigns({
          client,
          cache: "no-store",
        }),
      "Failed to fetch badge campaigns",
    );

    return response.data;
  }

  async function createAdminBadgeCampaign(
    body: NonNullable<CreateAdminBadgeCampaignData["body"]>,
  ) {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreCreateAdminBadgeCampaign({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create badge campaign",
    );

    return response.data;
  }

  async function updateAdminBadgeCampaign(
    id: string,
    body: NonNullable<UpdateAdminBadgeCampaignData["body"]>,
  ) {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreUpdateAdminBadgeCampaign({
          client,
          path: { id },
          body,
          cache: "no-store",
        }),
      "Failed to update badge campaign",
    );

    return response.data;
  }

  async function startAdminBadgeCampaign(id: string) {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreStartAdminBadgeCampaign({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to start badge campaign",
    );

    return response.data;
  }

  async function endAdminBadgeCampaign(id: string) {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreEndAdminBadgeCampaign({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to end badge campaign",
    );

    return response.data;
  }

  async function deleteAdminBadgeCampaign(id: string) {
    await executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteAdminBadgeCampaign({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to delete badge campaign",
    );
  }

  async function listAdminVendors() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminVendors({
          client,
          cache: "no-store",
        }),
      "Failed to fetch admin vendors",
    );
  }

  async function createAdminVendor(
    body: NonNullable<CreateAdminVendorData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCreateAdminVendor({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create vendor",
    );
  }

  async function patchAdminVendor(
    id: string,
    body: NonNullable<PatchAdminVendorData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchAdminVendor({
          client,
          path: { id },
          body,
          cache: "no-store",
        }),
      "Failed to update vendor",
    );
  }

  async function listMyVendorMemberships() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListMyVendorMemberships({
          client,
          cache: "no-store",
        }),
      "Failed to fetch vendor memberships",
    );
  }

  async function patchVendor(
    id: string,
    body: NonNullable<PatchVendorData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchVendor({
          client,
          path: { id },
          body,
          cache: "no-store",
        }),
      "Failed to update vendor",
    );
  }

  async function listVendorMembers(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListVendorMembers({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch vendor members",
    );
  }

  async function listCoworkerAssignments(vendorId: string, coworkerId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListCoworkerAssignments({
          client,
          path: { id: vendorId, coworkerId },
          cache: "no-store",
        }),
      "Failed to fetch coworker assignments",
    );
  }

  async function assignCoworkerDeveloper(
    vendorId: string,
    coworkerId: string,
    userId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreAssignCoworkerDeveloper({
          client,
          path: { id: vendorId, coworkerId },
          body: { userId },
          cache: "no-store",
        }),
      "Failed to assign developer to coworker",
    );
  }

  async function unassignCoworkerDeveloper(
    vendorId: string,
    coworkerId: string,
    userId: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreUnassignCoworkerDeveloper({
          client,
          path: { id: vendorId, coworkerId, userId },
          cache: "no-store",
        }),
      "Failed to unassign developer from coworker",
    );
  }

  async function createTask(body: NonNullable<PostTasksData["body"]>) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostTasks({
          client,
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to create task",
    );
  }

  async function createTaskEvent(
    id: string,
    body: {
      status?:
        | "DRAFT"
        | "QUEUED"
        | "READY"
        | "GRANT_PENDING"
        | "INPUT_REQUIRED"
        | "APPROVAL_REQUIRED"
        | "AUTHENTICATION_REQUIRED"
        | "OUT_OF_CREDITS"
        | "CREDITS_TOPPED_UP"
        | "RUNNING"
        | "AWAITING_EXTERNAL"
        | "COMPLETED"
        | "FAILED"
        | "CANCELED";
      comment?: string;
      mentionedUserIds?: string[];
    },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostTasksByIdEvents({
          client,
          path: { id },
          body,
        }),
      "Failed to create task event",
    );
  }

  async function suggestTaskTags(body: {
    name?: string;
    description?: string | null;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreSuggestTaskTags({ client, body }),
      "Task tag suggestions unavailable",
    );
  }

  async function patchTask(
    id: string,
    body: NonNullable<PatchTasksByIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchTasksById({
          client,
          path: { id },
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to update task",
    );
  }

  async function getTaskLinks(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksByIdLinks({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch task links",
    );
  }

  async function createTaskLink(
    id: string,
    body: NonNullable<PostTasksByIdLinksData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostTasksByIdLinks({
          client,
          path: { id },
          body,
        }),
      "Failed to create task link",
    );
  }

  async function deleteTaskLink(id: string, linkId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteTasksByIdLinksByLinkId({
          client,
          path: { id, linkId },
        }),
      "Failed to delete task link",
    );
  }

  async function deleteTaskParticipant(id: string, userId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteTasksByIdParticipantsByUserId({
          client,
          path: { id, userId },
        }),
      "Failed to remove task participant",
    );
  }

  async function subscribeTaskParticipant(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostTasksByIdParticipants({
          client,
          path: { id },
        }),
      "Failed to subscribe to task",
    );
  }

  async function deleteTask(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteTasksById({
          client,
          path: { id },
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to delete task",
    );
  }

  async function listTaskSchedules(query?: GetTasksSchedulesData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksSchedules({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch Task Schedules",
    );
  }

  async function getTaskScheduleAssignees() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetTaskScheduleAssignees({ client, cache: "no-store" }),
      "Failed to fetch Task Schedule assignees",
    );
  }

  async function createTaskSchedule(body: CreateTaskScheduleRequest) {
    return executeCoreOperation(
      getClient,
      (client) => corePostTasksSchedules({ client, body }),
      "Failed to create Task Schedule",
    );
  }

  async function getTaskSchedule(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksSchedulesById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch Task Schedule",
    );
  }

  async function updateTaskSchedule(
    id: string,
    body: UpdateTaskScheduleRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) => corePatchTasksSchedulesById({ client, path: { id }, body }),
      "Failed to update Task Schedule",
    );
  }

  async function changeTaskScheduleState(
    id: string,
    action: TaskScheduleStateAction,
  ) {
    const operation = {
      pause: corePostTasksSchedulesByIdPause,
      resume: corePostTasksSchedulesByIdResume,
      end: corePostTasksSchedulesByIdEnd,
    }[action];
    return executeCoreOperation(
      getClient,
      (client) => operation({ client, path: { id } }),
      `Failed to ${action} Task Schedule`,
    );
  }

  async function deleteTaskScheduleById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreDeleteTasksSchedulesById({ client, path: { id } }),
      "Failed to delete Task Schedule",
    );
  }

  async function listTaskScheduleRuns(
    id: string,
    query?: GetTasksSchedulesByIdRunsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetTasksSchedulesByIdRuns({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch Task Schedule Runs",
    );
  }

  async function createTaskScheduleRun(
    id: string,
    body: CreateTaskScheduleRunRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostTasksSchedulesByIdRuns({
          client,
          path: { id },
          body,
        }),
      "Failed to run Task Schedule now",
    );
  }

  async function changeTaskScheduleRun(
    id: string,
    runId: string,
    body: UpdateTaskScheduleRunRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchTasksSchedulesByIdRunsByRunId({
          client,
          path: { id, runId },
          body,
        }),
      "Failed to change Task Schedule Run",
    );
  }

  async function getCoworkers(query?: GetCoworkersData["query"]) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCoworkers({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch coworkers",
    );
  }

  async function getOwnedCoworkers() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCoworkers({
          client,
          query: { scope: "owned" },
          cache: "no-store",
        }),
      "Failed to fetch owned coworkers",
    );
  }

  async function getCoworkerById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCoworkersById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch coworker",
    );
  }

  async function getOwnedCoworkerById(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetCoworkersById({
          client,
          path: { id },
          query: { scope: "owned" },
          cache: "no-store",
        }),
      "Failed to fetch owned coworker",
    );
  }

  async function patchCoworker(
    id: string,
    body: NonNullable<PatchCoworkersByIdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchCoworkersById({
          client,
          path: { id },
          body,
        }),
      "Failed to update coworker",
    );
  }

  async function uploadCoworkerImage(id: string, file: Blob | File) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostCoworkersByIdImage({
          client,
          path: { id },
          body: { file },
          cache: "no-store",
        }),
      "Failed to upload coworker image",
    );
  }

  async function deleteCoworkerImage(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteCoworkersByIdImage({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to remove coworker image",
    );
  }

  async function patchCoworkerWhitelist(
    id: string,
    body: NonNullable<PatchCoworkersByIdWhitelistData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchCoworkersByIdWhitelist({
          client,
          path: { id },
          body,
        }),
      "Failed to update coworker whitelist",
    );
  }

  async function archiveCoworker(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteCoworkersById({
          client,
          path: { id },
        }),
      "Failed to archive coworker",
    );
  }

  async function unarchiveCoworker(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostCoworkersByIdUnarchive({
          client,
          path: { id },
        }),
      "Failed to unarchive coworker",
    );
  }

  async function getMyBadgeCampaigns() {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreGetUserBadgeCampaigns({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch badge campaigns",
    );

    return response.data.badgeCampaigns;
  }

  async function markBadgeCampaignSeen(campaignId: string) {
    await executeCoreOperation(
      getClient,
      (client) =>
        coreMarkUserBadgeCampaignSeen({
          client,
          path: { id: CURRENT_USER_PATH_ID, campaignId },
        }),
      "Failed to mark badge campaign seen",
    );
  }

  async function getPendingNotices(kind?: NoticeKind): Promise<Notice[]> {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdNoticesPending({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch pending notices",
    );

    const pendingNotices = response.data.pendingNotices;
    return kind
      ? pendingNotices.filter((notice) => notice.kind === kind)
      : pendingNotices;
  }

  async function acknowledgeNotice(id: string) {
    const response = await executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdNoticesByNoticeIdAcknowledge({
          client,
          path: { id: CURRENT_USER_PATH_ID, noticeId: id },
        }),
      "Failed to acknowledge notice",
    );

    return response.data;
  }

  async function getMyCredits() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdCredits({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user credits",
    );
  }

  async function getMyOrganizations() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdOrganizations({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user organizations",
    );
  }

  async function getMyMembersWithOrganizations() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdMembers({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user memberships",
    );
  }

  /**
   * The current user's workspaces and pending invitation count (ADR 0051).
   * Sole source of truth for the workspace gate (not `onboardingCompleted`).
   */
  async function getMyWorkspaces() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdWorkspaces({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch workspaces",
    );
  }

  /**
   * Non-expired pending organization invitations for the current user
   * (email match). Chat guest invitations are not included.
   */
  async function getMyPendingOrganizationInvitations() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdPendingOrganizationInvitations({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch pending organization invitations",
    );
  }

  /**
   * Returns the current user's membership in `organizationId`, or `null` when
   * the user is not a member (Core responds 404 in that case).
   */
  async function getMyMemberInOrganization(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetUsersByIdOrganizationsByOrganizationIdMember({
          client,
          path: { id: CURRENT_USER_PATH_ID, organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization membership",
    ).catch(nullWhenNotFound);
  }

  /**
   * Resolves the DESIGN.md in effect for the caller's current workspace. Core
   * derives the active workspace from the session (the active organization, or
   * the personal workspace when none).
   */
  async function getWorkspaceDesignMd() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetWorkspacesDesignMd({
          client,
          cache: "no-store",
        }),
      "Failed to resolve workspace DESIGN.md",
    );
  }

  async function getWorkspaceCalendar(
    query: GetWorkspacesCalendarData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetWorkspacesCalendar({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch workspace calendar",
    );
  }

  async function getWorkspaceCalendarSources(
    query?: GetWorkspacesCalendarSourcesData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetWorkspacesCalendarSources({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch workspace calendar sources",
    );
  }

  /**
   * Stores a DESIGN.md for one-off, ad hoc use — content generated for a
   * single task's branding, never attached to the caller's user or
   * organization profile. Any authenticated user may call this.
   */
  async function storeAdHocDesignMd(
    body: NonNullable<PostWorkspacesDesignMdAdhocData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostWorkspacesDesignMdAdhoc({
          client,
          body,
        }),
      "Failed to store ad hoc DESIGN.md",
    );
  }

  async function getWorkspaceOrganizationId(workspaceId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetWorkspacesById({
          client,
          path: { id: workspaceId },
          cache: "no-store",
        }),
      "Failed to resolve workspace organization",
    );
  }

  /**
   * Sets (or clears, when `content` is null) the current user's own DESIGN.md.
   */
  async function setMyDesignMd(
    body: NonNullable<PutUsersByIdDesignMdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutUsersByIdDesignMd({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
        }),
      "Failed to save DESIGN.md",
    );
  }

  /**
   * Sets which of the current user's workspaces a new session opens, by
   * workspace id from {@link getMyWorkspaces} (404 when it is not theirs).
   */
  async function setMyPreferredWorkspace(workspaceId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutUsersByIdWorkspacesPreferred({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body: { workspaceId },
          cache: "no-store",
        }),
      "Failed to set preferred workspace",
    );
  }

  /**
   * Sets (or clears, when `content` is null) an organization's DESIGN.md. Core
   * enforces that the caller is an organization owner or admin.
   */
  async function setOrganizationDesignMd(
    organizationId: string,
    body: NonNullable<PutOrganizationsByIdDesignMdData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutOrganizationsByIdDesignMd({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to save organization DESIGN.md",
    );
  }

  /**
   * Creates a shareable, email-agnostic invite link for an organization. Core
   * enforces that the caller is an owner or admin. Returns the link with its
   * absolute `/join/{token}` URL.
   */
  async function createOrganizationInviteLink(
    organizationId: string,
    body: NonNullable<PostOrganizationsByIdInviteLinksData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdInviteLinks({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to create invite link",
    );
  }

  /**
   * Revokes an organization invite link by token. Owner/admin only; the token
   * is scoped to the organization in the path so a token cannot be revoked
   * from another organization.
   */
  async function revokeOrganizationInviteLink(
    organizationId: string,
    token: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDeleteOrganizationsByIdInviteLinksByToken({
          client,
          path: { id: organizationId, token },
        }),
      "Failed to revoke invite link",
    );
  }

  /**
   * Resolves a shareable invite-link token for the public `/join` preview.
   * Returns the link status and, only for a live (`valid`) link, a small
   * organization preview (name, slug, logo).
   */
  async function resolveOrganizationInviteLink(token: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationInviteLinksByToken({
          client,
          path: { token },
          cache: "no-store",
        }),
      "Failed to resolve invite link",
    );
  }

  /**
   * Accepts a shareable invite-link token for the signed-in user, joining the
   * organization as a member (subject to the org's billing seat gate). Core
   * treats a concurrent/duplicate join as `already_member`.
   */
  async function acceptOrganizationInviteLink(token: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationInviteLinksByTokenAccept({
          client,
          path: { token },
        }),
      "Failed to accept invite link",
    );
  }

  /**
   * Resolves the highest-quality icon for a website URL and uploads it as an
   * organization-logo blob, returning its public URL (or null when no usable
   * icon was found). Core performs the SSRF-guarded fetch server-side.
   */
  async function resolveSiteIcon(url: string, organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetToolsSiteIcon({
          client,
          query: { url, organizationId },
          cache: "no-store",
        }),
      "Failed to resolve site icon",
    );
  }

  /**
   * Resolves the highest-quality icon for a website URL and uploads it as a
   * project-logo blob. Core performs the SSRF-guarded fetch server-side.
   */
  async function resolveProjectSiteIcon(url: string, projectId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetToolsSiteIcon({
          client,
          query: { url, projectId },
          cache: "no-store",
        }),
      "Failed to resolve project site icon",
    );
  }

  /**
   * Fetches an organization by id, returning null when it does not exist
   * (Core responds 404).
   */
  async function getOrganizationById(organizationId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationsById({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization",
    ).catch(nullWhenNotFound);
  }

  /**
   * Fetches the raw organization record by slug for the current member,
   * returning null when no organization matches the slug (Core responds 404).
   * A 403 (the caller is not a member) propagates as CoreApiRequestError.
   */
  async function getOrganizationBySlug(slug: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetOrganizationBySlug({
          client,
          path: { slug },
          cache: "no-store",
        }),
      "Failed to fetch organization",
    ).catch(nullWhenNotFound);
  }

  async function searchChatSkills(q: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreSearchChatSkills({ client, query: q ? { q } : {} }),
      "Failed to search skills",
    );
  }

  async function createMyFileUploadSession(
    body: NonNullable<PostUsersByIdFilesData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostUsersByIdFiles({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
          cache: "no-store",
        }),
      "Failed to create upload session",
    );
  }

  async function createOrganizationLogoUploadSession(
    organizationId: string,
    body: NonNullable<PostOrganizationsByIdFilesData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdFiles({
          client,
          path: { id: organizationId },
          body,
          cache: "no-store",
        }),
      "Failed to create organization logo upload session",
    );
  }

  async function cleanupOrganizationLogo(
    organizationId: string,
    body: NonNullable<PostOrganizationsByIdFilesCleanupData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdFilesCleanup({
          client,
          path: { id: organizationId },
          body,
          cache: "no-store",
        }),
      "Failed to cleanup organization logo",
    );
  }

  async function createVendorLogoUploadSession(
    vendorId: string,
    body: NonNullable<PostVendorsByIdFilesData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostVendorsByIdFiles({
          client,
          path: { id: vendorId },
          body,
          cache: "no-store",
        }),
      "Failed to create vendor logo upload session",
    );
  }

  async function cleanupVendorLogo(
    vendorId: string,
    body: NonNullable<PostVendorsByIdFilesCleanupData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostVendorsByIdFilesCleanup({
          client,
          path: { id: vendorId },
          body,
          cache: "no-store",
        }),
      "Failed to cleanup vendor logo",
    );
  }

  async function createTaskFileUploadSession(
    taskId: string,
    body: NonNullable<PostTasksByIdFilesData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostTasksByIdFiles({
          client,
          path: { id: taskId },
          body,
          cache: "no-store",
        }),
      "Failed to create task file upload session",
    );
  }

  async function createChatRoomFileUploadSession(
    roomId: string,
    body: NonNullable<PostChatsRoomsByIdFilesData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdFiles({
          client,
          path: { id: roomId },
          body,
          cache: "no-store",
        }),
      "Failed to create chat room file upload session",
    );
  }

  async function moveTaskToWorkspace(
    id: string,
    body: { organizationId: string | null },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutTasksByIdWorkspace({
          client,
          path: { id },
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to move task to workspace",
    );
  }

  async function moveJobToWorkspace(
    id: string,
    body: { organizationId: string | null },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePutJobsByIdWorkspace({
          client,
          path: { id },
          body,
        }),
      "Failed to move job to workspace",
    );
  }

  async function provideJobInput(
    id: string,
    body: NonNullable<PostJobsByIdInputsData["body"]>,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostJobsByIdInputs({
          client,
          path: { id },
          body,
        }),
      "Failed to provide job input",
    );
  }

  async function putJobShare(
    id: string,
    body: { allowSearchIndexing: boolean },
  ) {
    return executeCoreOperation(
      getClient,
      async (client) => {
        const result = await corePutJobsByIdShare({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PutJobsByIdShareError,
            response: result.response,
          };
        }
        return {
          data: result.data.data,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to update job share",
    );
  }

  async function deleteJobShare(id: string) {
    await executeCoreOperation(
      getClient,
      async (client) => {
        const result = await coreDeleteJobsByIdShare({
          client,
          path: { id },
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as DeleteJobsByIdShareError,
            response: result.response,
          };
        }

        return {
          data: true,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to delete job share",
    );
  }

  async function putTaskShare(
    id: string,
    body: { allowSearchIndexing: boolean },
  ) {
    return executeCoreOperation(
      getClient,
      async (client) => {
        const result = await corePutTasksByIdShare({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PutTasksByIdShareError,
            response: result.response,
          };
        }
        return {
          data: result.data.data,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to update task share",
    );
  }

  async function deleteTaskShare(id: string) {
    await executeCoreOperation(
      getClient,
      async (client) => {
        const result = await coreDeleteTasksByIdShare({
          client,
          path: { id },
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as DeleteTasksByIdShareError,
            response: result.response,
          };
        }

        return {
          data: true,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to delete task share",
    );
  }

  async function getSharedResourceByToken(token: string) {
    return executeCoreOperation(
      getClient,
      async (client) => {
        const result = await coreGetShareByToken({
          client,
          path: { token },
          cache: "no-store",
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as GetShareByTokenError,
            response: result.response,
          };
        }
        return {
          data: mapCorePublicSharedResourceResponse(result.data.data),
          error: undefined,
          response: result.response,
        };
      },
      "Failed to fetch shared resource",
    );
  }

  async function listEnterpriseContracts(
    query?: GetEnterpriseContractsData["query"],
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetEnterpriseContracts({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list enterprise contracts",
    );
  }

  async function createEnterpriseContract(
    body: CreateEnterpriseContractRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostEnterpriseContracts({
          client,
          body,
        }),
      "Failed to create enterprise contract",
    );
  }

  async function getEnterpriseContract(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetEnterpriseContractsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch enterprise contract",
    );
  }

  async function patchEnterpriseContract(
    id: string,
    body: PatchEnterpriseContractRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePatchEnterpriseContractsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update enterprise contract",
    );
  }

  async function previewEnterpriseContractPeriods(
    id: string,
    activatedAt: Date,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetEnterpriseContractsByIdPeriodsPreview({
          client,
          path: { id },
          query: { activatedAt },
          cache: "no-store",
        }),
      "Failed to preview enterprise contract periods",
    );
  }

  async function activateEnterpriseContract(
    id: string,
    body?: ActivateEnterpriseContractRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostEnterpriseContractsByIdActivate({
          client,
          path: { id },
          body,
        }),
      "Failed to activate enterprise contract",
    );
  }

  async function cancelEnterpriseContract(id: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePostEnterpriseContractsByIdCancel({
          client,
          path: { id },
        }),
      "Failed to cancel enterprise contract",
    );
  }

  return {
    activateEnterpriseContract,
    cancelEnterpriseContract,
    createEnterpriseContract,
    getEnterpriseContract,
    listEnterpriseContracts,
    patchEnterpriseContract,
    previewEnterpriseContractPeriods,
    acknowledgeNotice,
    acceptChatRoomGuestInviteLink,
    acceptChatRoomInvitation,
    addChatRoomMessage,
    archiveChatRoom,
    createChatRoomGuestInviteLink,
    createChatRoomInvitation,
    declineChatRoomInvitation,
    deleteChatRoom,
    restoreChatRoom,
    leaveChatRoom,
    addChatRoomMembers,
    removeChatRoomMember,
    removeChatRoomCoworker,
    removeChatRoomSokoBot,
    joinChatRoom,
    assignOrganizationSeat,
    createChatRoom,
    createAgentJob,
    createChatRoomFileUploadSession,
    getChatRoomInvitation,
    listChatRoomGuestInviteLinks,
    listChatRoomInvitations,
    resolveChatRoomGuestInviteLink,
    revokeChatRoomGuestInviteLink,
    revokeChatRoomInvitation,
    cleanupOrganizationLogo,
    cleanupVendorLogo,
    createMyFileUploadSession,
    createOrganizationLogoUploadSession,
    createVendorLogoUploadSession,
    createTask,
    createTaskFileUploadSession,
    createTaskLink,
    createTaskEvent,
    deleteJobShare,
    deleteProjectsByIdDesignMd,
    deleteProjectsByIdAdsAccountsByAccountId,
    deleteProjectsByIdAdsConnectionsByAdConnectionId,
    deleteProjectsByIdJobsByJobId,
    deleteProjectsByIdSocialConnectionsByConnectionId,
    deleteProjectsByIdTasksByTaskId,
    deleteTaskShare,
    deleteTaskLink,
    deleteTaskParticipant,
    deleteTask,
    subscribeTaskParticipant,
    getChatRoom,
    getChatRoomInvitations,
    getChatRoomMessages,
    getChatRoomMessage,
    getChatRoomMessageResults,
    getChatRoomMessageResultsBatch,
    getChatRoomThread,
    getChatRoomThreadMessages,
    getChatRoomThreads,
    getChatRoomThreadsUnreadCount,
    getChatUnreadThreads,
    getChatEarlierThreads,
    getChatRooms,
    getChannelSlugAvailability,
    getDiscoverableChatRooms,
    markChatRoomRead,
    markChatRoomThreadsRead,
    markChatRoomThreadRead,
    muteChatRoomThread,
    unmuteChatRoomThread,
    pinChatRoom,
    unpinChatRoom,
    reorderPinnedChatRooms,
    getChatRoomPinnedMessages,
    getChatNeedsYou,
    getChatOpenLoops,
    getChatCatchUpSummary,
    getChatRoomCatchUp,
    getChatRoomDecisions,
    correctChatMessageSignal,
    setChatMessageSignalLoop,
    getChatMessageRoutingSuggestions,
    pinChatRoomMessage,
    unpinChatRoomMessage,
    sendChatRoomMessageToSelf,
    muteChatRoom,
    unmuteChatRoom,
    markChatRoomUnread,
    deleteChatRoomMessage,
    removeChatRoomMessageUnfurl,
    retryChatRoomMention,
    addChatRoomMessageReaction,
    removeChatRoomMessageReaction,
    getHistory,
    getTransactions,
    getTransactionsDaily,
    getNotifications,
    getNotificationsCounts,
    updateChatRoom,
    updateChatRoomMessage,
    patchNotificationRead,
    patchNotificationsReadAll,
    getAgentById,
    getAgentJobs,
    getAgentInputSchema,
    getAgentRatingEligibility,
    getAgentReviews,
    getMyAgentReview,
    getAgents,
    createAgentRating,
    getCategories,
    getCoworkers,
    getOwnedCoworkers,
    getCoworkerById,
    getOwnedCoworkerById,
    patchCoworker,
    patchCoworkerWhitelist,
    archiveCoworker,
    unarchiveCoworker,
    uploadCoworkerImage,
    deleteCoworkerImage,
    searchAdminUsers,
    listAdminUsers,
    getUserById,
    getUserSignUp,
    startAdminImpersonation,
    stopAdminImpersonation,
    listAdminAgents,
    getAdminAgent,
    patchAdminAgentMetadataOverride,
    deleteAdminAgentMetadataOverride,
    listAdminTasks,
    getAdminTask,
    listAdminTaskX402Payments,
    aggregateAdminTaskX402Payments,
    refundAdminTaskX402Payment,
    resolveAdminTaskX402Payment,
    listDeveloperOwnedCoworkerTasks,
    getDeveloperOwnedCoworkerTask,
    searchAdminOrganizations,
    getAdminOrganizationBySlug,
    listAdminOrganizations,
    listAdminOrganizationMembers,
    listAdminMatchedChannels,
    createAdminMatchedChannel,
    getAdminMatchedChannel,
    addAdminMatchedChannelParticipant,
    addAdminMatchedChannelParticipantsFromOrganization,
    removeAdminMatchedChannelParticipant,
    archiveAdminMatchedChannel,
    restoreAdminMatchedChannel,
    deleteAdminMatchedChannel,
    addAdminOrganizationMember,
    removeAdminOrganizationMember,
    updateAdminOrganizationMemberRole,
    assignAdminOrganizationMemberSeat,
    unassignAdminOrganizationMemberSeat,
    listAdminInvoices,
    createAdminInvoice,
    createAdminFreeCreditGrant,
    getAdminInvoice,
    markAdminInvoicePaid,
    deleteAdminInvoice,
    listCreditPrices,
    getCreditTopUpPriceCatalog,
    getSubscriptionCatalog,
    createCreditCheckoutSession,
    getCheckoutSessionAnalytics,
    getCouponDetails,
    claimCoupon,
    getOrganizationEnterpriseContractSummary,
    getJobById,
    getJobs,
    getInvitationById,
    getMyActiveSubscription,
    getMyCredits,
    getMyDeletion,
    getMyMemberInOrganization,
    getMyMembersWithOrganizations,
    getMyWorkspaces,
    getMyPendingOrganizationInvitations,
    getMyOrganizationCredits,
    getMyOrganizations,
    createMyStripeCustomer,
    createMyWorkspace,
    deleteMyWorkspace,
    createOrganizationStripeCustomer,
    getMyBillingDetails,
    getUserBillingDetails,
    getMyStripeCustomer,
    getOrganizationActiveSubscription,
    getOrganizationBillingDetails,
    getOrganizationBillingPlan,
    getOrganizationCallerSeat,
    getOrganizationById,
    getOrganizationDeletion,
    getOrganizationBySlug,
    getOrganizationMembers,
    getOrganizationPendingInvitations,
    getOrganizationInviteLinks,
    getOrganizationVendorGrants,
    createOrganizationVendorGrant,
    approveOrganizationVendorGrant,
    denyOrganizationVendorGrant,
    revokeOrganizationVendorGrant,
    getMyVendorGrants,
    createMyVendorGrant,
    approveMyVendorGrant,
    denyMyVendorGrant,
    revokeMyVendorGrant,
    getMyCoworkerAccess,
    approveMyCoworkerAccess,
    denyMyCoworkerAccess,
    revokeMyCoworkerAccess,
    getOrganizationCoworkerAccess,
    approveOrganizationCoworkerAccess,
    denyOrganizationCoworkerAccess,
    revokeOrganizationCoworkerAccess,
    listCoworkerWorkspaceAccess,
    createCoworkerWorkspaceAccess,
    revokeCoworkerWorkspaceAccessAsPlatformAdmin,
    listVendors,
    listAdminBadgeCampaigns,
    createAdminBadgeCampaign,
    updateAdminBadgeCampaign,
    startAdminBadgeCampaign,
    endAdminBadgeCampaign,
    deleteAdminBadgeCampaign,
    listAdminVendors,
    createAdminVendor,
    patchAdminVendor,
    listMyVendorMemberships,
    patchVendor,
    listVendorMembers,
    listCoworkerAssignments,
    assignCoworkerDeveloper,
    unassignCoworkerDeveloper,
    getOrganizationSeatSummary,
    getOrganizationStripeCustomer,
    getWorkspaceDesignMd,
    getWorkspaceCalendar,
    getWorkspaceCalendarSources,
    getWorkspaceOrganizationId,
    setMyDesignMd,
    setMyPreferredWorkspace,
    setOrganizationDesignMd,
    storeAdHocDesignMd,
    createOrganizationInviteLink,
    revokeOrganizationInviteLink,
    resolveOrganizationInviteLink,
    acceptOrganizationInviteLink,
    resolveSiteIcon,
    resolveProjectSiteIcon,
    getMyBadgeCampaigns,
    markBadgeCampaignSeen,
    getPendingNotices,
    getPinnedProjects,
    getProjects,
    pinProject,
    unpinProject,
    getProjectsById,
    getProjectsByIdCalendar,
    getProjectsByIdClose,
    getProjectsByIdContextMd,
    getProjectsByIdNeedsAttention,
    getProjectsByIdAdsAccounts,
    getProjectsByIdAdsAccountsByAccountIdCampaigns,
    getProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
    getProjectsByIdAdsAccountsByAccountIdTargetingLocations,
    getProjectsByIdAdsAccountsByAccountIdTargetingLanguages,
    getProjectsByIdAdsMarket,
    putProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
    putProjectsByIdAdsMarket,
    getProjectsByIdAdsMarketKeywords,
    getProjectsByIdAdsMarketAds,
    getProjectsByIdSocialConnections,
    getImageStudioCatalog,
    getImageStudioState,
    getProjectsByIdImageStudio,
    getProjectsByIdImageStudioAssetsByAssetIdSocialMedia,
    postProjectsByIdImageStudioJobs,
    postProjectsByIdImageStudioJobsByJobIdCancel,
    postProjectsByIdImageStudioVideoJobs,
    getProjectsByIdSocialPosts,
    getProjectsByIdSocialPostsStatistics,
    getProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes,
    getProjectsByIdSocialConnectionsStatistics,
    getProjectsByIdSocialConnectionsByConnectionIdStatisticsAudience,
    getProjectsByIdSocialConnectionsByConnectionIdStatisticsBenchmark,
    getProjectsByIdSocialConnectionsByConnectionIdStatisticsDiscovery,
    postProjectsByIdSocialConnectionsByConnectionIdStatisticsRefresh,
    postProjectsByIdSocialPostsByPostIdStatisticsRefresh,
    getProjectsByIdSocialPostsByPostId,
    patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
    patchProjectsByIdSocialPostsByPostId,
    postProjectsByIdSocialPosts,
    postProjectsByIdSocialPostsByPostIdCancel,
    postProjectsByIdSocialAccountPostsByAccountPostIdRecycle,
    postProjectsByIdSocialPostsByPostIdDuplicate,
    postProjectsByIdSocialPostsByPostIdPublish,
    postProjectsByIdSocialPostsByPostIdSchedule,
    completeComposioCallback,
    getProjectsStats,
    getSharedResourceByToken,
    moveJobToWorkspace,
    moveTaskToWorkspace,
    patchJob,
    provideJobInput,
    patchProjectsById,
    putProjectsByIdDesignMd,
    postProjects,
    postProjectsByIdClose,
    postProjectsByIdCloseCancelOwed,
    postProjectsByIdCloseRetry,
    postProjectsByIdJobs,
    postProjectsByIdAdsAccounts,
    postProjectsByIdAdsAccountsByAccountIdCampaigns,
    postProjectsByIdAdsConnectionsFinalize,
    postProjectsByIdAdsConnectionsInitiate,
    postProjectsByIdSocialConnectionsFinalize,
    postProjectsByIdSocialConnectionsInitiate,
    postProjectsByIdTasks,
    requestJobRefund,
    revokeMyOauthConsent,
    getTaskById,
    getTaskEvents,
    getTaskLinks,
    getTaskWorkspace,
    getTasks,
    getTasksSummary,
    patchTask,
    suggestTaskTags,
    putJobShare,
    putTaskShare,
    listTaskSchedules,
    getTaskScheduleAssignees,
    createTaskSchedule,
    getTaskSchedule,
    updateTaskSchedule,
    changeTaskScheduleState,
    deleteTaskScheduleById,
    listTaskScheduleRuns,
    createTaskScheduleRun,
    changeTaskScheduleRun,
    unassignOrganizationSeat,
    updateOrganizationSubscriptionSeats,
    ...createSokoBotAvatarClient(getClient),
    ...createSokoBotClient(getClient),
    searchChatSkills,
  };
}

export type CoreClient = ReturnType<typeof createCoreClient>;
