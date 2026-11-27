/**
 * Stable machine-readable identifiers carried in the Core API error
 * envelope's optional `kind` field.
 *
 * Consumers (the web app) MUST match on these constants instead of the
 * human-readable `message`, which may be reworded at any time. Values are
 * part of the public API contract: never change an existing value, only add
 * new ones.
 */
export const CORE_API_ERROR_KINDS = {
  AI_BUDGET_EXCEEDED: "ai_budget_exceeded",
  CALENDAR_CLIENT_UPGRADE_REQUIRED: "calendar_client_upgrade_required",
  /** CMO is invite-only: the person is not on Core's `CMO_HIRE_ALLOWLIST`. */
  CMO_HIRE_NOT_ALLOWED: "cmo_hire_not_allowed",
  /** A `/v1/cmo` write came from another app than CMO's (`CMO_OAUTH_CLIENT_ID`). */
  CMO_CLIENT_REQUIRED: "cmo_client_required",
  /** The Project has a live Cuso, so only CMO changes it (ADR 0066). */
  CMO_PROJECT_READ_ONLY: "cmo_project_read_only",
  /** The person already hired a Cuso nobody paid for; `unpaidCuso` names him. */
  CMO_UNPAID_CUSO: "cmo_unpaid_cuso",
  /** A test copy's source has no live Cuso the person can see (ADR 0073). */
  CMO_TEST_COPY_SOURCE_NOT_HIRED: "cmo_test_copy_source_not_hired",
  /** A test copy was asked for in another organization than its source's. */
  CMO_TEST_COPY_OTHER_ORGANIZATION: "cmo_test_copy_other_organization",
  /** The source is itself a test copy. */
  CMO_TEST_COPY_OF_TEST_COPY: "cmo_test_copy_of_test_copy",
  /** Only an owner or admin of the source's organization, or a tester, copies. */
  CMO_TEST_COPY_NOT_ALLOWED: "cmo_test_copy_not_allowed",
  /** The Project already watches as many competitors as it may. */
  COMPETITOR_LIMIT_REACHED: "competitor_limit_reached",
  /** Another competitor of the Project holds the name. */
  COMPETITOR_NAME_TAKEN: "competitor_name_taken",
  /** An Undo for a removal that is no longer the competitor's latest change. */
  COMPETITOR_REMOVAL_STALE: "competitor_removal_stale",
  CONCURRENCY_CONFLICT: "concurrency_conflict",
  /** A channel being added already belongs to another contact; `existingContactId` names it. */
  CONTACT_CHANNEL_TAKEN: "contact_channel_taken",
  /** The contact changed since it was read; reload and apply the edit again. */
  CONTACT_VERSION_CONFLICT: "contact_version_conflict",
  /** A coworker must send `X-Context-Organization-Id`: the context user has no personal workspace. */
  CONTEXT_ORGANIZATION_REQUIRED: "context_organization_required",
  /** A file or folder in a data room gets no share link; invite people to the room instead. */
  DRIVE_SHARE_IN_DATA_ROOM: "drive_share_in_data_room",
  INTEGRATION_NOT_CONFIGURED: "integration_not_configured",
  INVOICE_INVALID: "invoice_invalid",
  INVOICE_NOT_FOUND: "invoice_not_found",
  /** The API key belongs to the other Network than `X-Sokosumi-Network` names. */
  API_KEY_NETWORK_MISMATCH: "api_key_network_mismatch",
  INSUFFICIENT_BALANCE: "insufficient_balance",
  /** A valid OAuth access token without `sokosumi:api` (RFC 6750 §3.1). */
  INSUFFICIENT_SCOPE: "insufficient_scope",
  MEMBER_NOT_FOUND: "member_not_found",
  /** A Coworker's payment names another Network than `X-Sokosumi-Network`. */
  NETWORK_MISMATCH: "network_mismatch",
  /** `X-Sokosumi-Network` names no Network: only `mainnet` and `preprod` are. */
  NETWORK_UNKNOWN: "network_unknown",
  NEWSLETTER_APPROVAL_REQUIRED: "newsletter_approval_required",
  NEWSLETTER_SENDER_NOT_CONFIGURED: "newsletter_sender_not_configured",
  NEWSLETTER_NO_ACTIVE_SUBSCRIBERS: "newsletter_no_active_subscribers",
  /** The user has no workspace, or a coworker may not act in the preferred one. */
  NO_PREFERRED_WORKSPACE: "no_preferred_workspace",
  ORGANIZATION_MEMBERSHIP_REQUIRED: "organization_membership_required",
  /** The person may own or join no more organizations. */
  ORGANIZATION_LIMIT_REACHED: "organization_limit_reached",
  ORGANIZATION_NOT_FOUND: "organization_not_found",
  /** The organization has no DESIGN.md a Project could start from. */
  ORGANIZATION_DESIGN_MD_MISSING: "organization_design_md_missing",
  ORGANIZATION_ROLE_FORBIDDEN: "organization_role_forbidden",
  ORGANIZATION_SEAT_REQUIRED: "organization_seat_required",
  SEAT_CAPACITY_EXCEEDED: "seat_capacity_exceeded",
  SUBSCRIPTION_CHANGE_NOT_ALLOWED: "subscription_change_not_allowed",
  SUBSCRIPTION_NOT_ACTIVE: "subscription_not_active",
  /** Stripe could not collect the payment, so the subscription was left unchanged. */
  SUBSCRIPTION_PAYMENT_FAILED: "subscription_payment_failed",
  SUBSCRIPTION_SEATS_BELOW_ASSIGNED: "subscription_seats_below_assigned",
  FREE_CREDIT_INVALID: "free_credit_invalid",
  LAST_WORKSPACE: "last_workspace",
  PERSONAL_WORKSPACE_MISSING: "personal_workspace_missing",
  /** A person approves, publishes or sends this in Sokosumi (ADR 0077); `webUrl` links the item. */
  PERSON_APPROVAL_REQUIRED: "person_approval_required",
  /** The request names Preprod, and Preprod is switched off on this deployment. */
  PREPROD_OFF: "preprod_off",
  PREPROD_PAUSED: "preprod_paused",
  PREPROD_CONTROL_UNAVAILABLE: "preprod_control_unavailable",
  /** The request names Preprod, and the caller has no Preprod access in this Workspace. */
  PREPROD_ACCESS_REQUIRED: "preprod_access_required",
  PROJECT_DELETION_REMOVED: "project_deletion_removed",
  /** The Project already has a DESIGN.md; a copy only fills an empty one. */
  PROJECT_DESIGN_MD_EXISTS: "project_design_md_exists",
  SEO_AUDIT_ACTIVE_CHECK: "seo_audit_active_check",
  SEO_AUDIT_ACTIVE_CHAT: "seo_audit_active_chat",
  SEO_AUDIT_RESUMABLE_MONITOR: "seo_audit_resumable_monitor",
  SEO_AUDIT_TASK_SCOPE_CONFLICT: "seo_audit_task_scope_conflict",
  SEO_GSC_NOT_CONNECTED: "seo_gsc_not_connected",
  SEO_GSC_RECONNECT: "seo_gsc_reconnect",
  SEO_GSC_PROPERTY: "seo_gsc_property",
  SEO_GSC_UNAVAILABLE: "seo_gsc_unavailable",
  /** Google answered a Task read with more than Core forwards to the SEO worker. */
  SEO_GSC_RESPONSE_TOO_LARGE: "seo_gsc_response_too_large",
  SCHEDULE_RUN_STATE_CONFLICT: "schedule_run_state_conflict",
  SCHEDULE_RUN_TARGET_INVALID: "schedule_run_target_invalid",
  QUEUED_REQUIRES_RUN_AT: "queued_requires_run_at",
  RUN_AT_NOT_IN_FUTURE: "run_at_not_in_future",
  STATUS_NOT_SELECTABLE: "status_not_selectable",
  SCHEDULE_OPERATION_CONFLICT: "schedule_operation_conflict",
  SCHEDULE_REVISION_CONFLICT: "schedule_revision_conflict",
  SCHEDULE_STATE_CONFLICT: "schedule_state_conflict",
  SOCIAL_POST_REVISION_CONFLICT: "social_post_revision_conflict",
  /** A Soko Bot turn was cancelled, paused or expired; its runner stops. */
  SOKO_BOT_TURN_INACTIVE: "soko_bot_turn_inactive",
  SOKO_BOT_NETWORK_STALE: "soko_bot_network_stale",
  SOCIAL_FACEBOOK_PAGE_REQUIRED: "social_facebook_page_required",
  SOCIAL_YOUTUBE_CHANNEL_REQUIRED: "social_youtube_channel_required",
  TASK_WORKSPACE_TAGS_CHANGED: "task_workspace_tags_changed",
  TASK_SCHEDULE_MOVED: "task_schedule_moved",
  WORKSPACE_HAS_DEPENDENTS: "workspace_has_dependents",
  CHANNEL_SLUG_TAKEN: "channel_slug_taken",
  PROJECT_IDENTIFIER_TAKEN: "project_identifier_taken",
} as const;

export type CoreApiErrorKind =
  (typeof CORE_API_ERROR_KINDS)[keyof typeof CORE_API_ERROR_KINDS];
