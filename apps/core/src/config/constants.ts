import {
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  FILE_UPLOAD_MAX_SIZE_BYTES,
} from "@sokosumi/utils";

/**
 * Time durations in seconds
 */
export const TIME = {
  /** Email verification link expiration (2 days) */
  EMAIL_VERIFICATION_EXPIRES: 2 * 24 * 60 * 60,

  /** Organization invitation expiration (7 days) */
  INVITATION_EXPIRES: 7 * 24 * 60 * 60,

  /** API key rate limit window (1 minute) */
  RATE_LIMIT_WINDOW: 60,

  /** CORS preflight cache duration (1 day) */
  CORS_MAX_AGE: 24 * 60 * 60,

  /** Agent execution metrics lookback period (90 days) */
  AGENT_EXECUTION_METRICS_DAYS: 90,

  /**
   * How long a session stays "fresh" after sign-in (15 minutes).
   *
   * Better Auth measures freshness from `Session.createdAt` and gates passkey
   * registration, account unlinking and password-less account deletion on it.
   * A short window keeps a stolen session or a leaked credential from turning
   * into a new login factor. Becoming fresh again means signing in again.
   */
  SESSION_FRESH_AGE: 15 * 60,
} as const;

/**
 * Rate limits and capacity constraints
 */
export const LIMITS = {
  /** Maximum API key requests per minute */
  API_KEY_MAX_REQUESTS_PER_MINUTE: 100,

  /**
   * Chat history reads one user may burst across all rooms and credentials
   * (SOK-1060). Covers fast room switching, pagination and reconnect
   * recovery; sustained polling drains it in seconds and then throttles.
   * Sized from documented client cadence (see REFILL): 30 absorbs a
   * multi-room reconnect storm no healthy client produces at once.
   */
  CHAT_MESSAGE_READ_BURST: 30,

  /**
   * Sustained chat history reads per second per user (SOK-1060). Healthy
   * clients read ~1/min per data set over Ably (web
   * `CHAT_HEALTHY_REFRESH_MS`, Apple 60 s healthy timer); degraded fallback
   * polls at 3 s for the open room only (web `ROOM_MESSAGE_FALLBACK_MS`,
   * Apple fallback interval) and 15 s elsewhere — a fully degraded
   * two-device user stays near ~60/min. Sustained multi-room polling above
   * that (the SOK-1060 sample ran ~142/min) throttles once the burst
   * drains.
   */
  CHAT_MESSAGE_READ_REFILL_PER_SECOND: 1,

  /** Maximum organization invitations per organization */
  ORGANIZATION_INVITATION_LIMIT: 100,

  /**
   * Maximum Soko Bot mascot images one user may cause to be generated per hour.
   * Each image is a paid FAL call, so this bounds what one account can spend.
   * Four full top-up pages, which is well past what picking one mascot needs.
   */
  SOKO_BOT_AVATAR_GENERATION_PER_HOUR: 24,

  /**
   * Image-studio generations one project may have in flight at once. Each is a
   * paid fal request, and the preview only shows one image at a time, so a
   * deep queue buys nothing and spends real money.
   */
  IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT: 3,

  /**
   * Image-studio generations one user may start per hour, across all projects.
   * Bounds what a single account can spend if a prompt loop goes wrong.
   */
  IMAGE_STUDIO_GENERATIONS_PER_USER_PER_HOUR: 40,

  /**
   * Largest reference image the studio will hand to the provider. Bytes are
   * uploaded to fal's own storage, so this bounds one upload, not a response.
   */
  IMAGE_STUDIO_MAX_REFERENCE_BYTES: 12 * 1024 * 1024,

  /** Reference images one refinement may carry. */
  IMAGE_STUDIO_MAX_REFERENCES_PER_JOB: 4,

  /** Largest generated image the studio will store. */
  IMAGE_STUDIO_MAX_ASSET_BYTES: 24 * 1024 * 1024,

  /**
   * Maximum pending guest invitations per external channel. Bounds email blast
   * abuse and keeps host invite lists usable.
   */
  CHAT_ROOM_GUEST_INVITATION_PENDING_LIMIT: 100,

  /**
   * Maximum guest invitations one inviter may create per hour (across rooms).
   * Complements the per-room pending cap for spam protection.
   */
  CHAT_ROOM_GUEST_INVITATION_CREATE_PER_HOUR: 30,

  /**
   * Maximum live (non-revoked, non-expired) shareable guest invite links per
   * external channel. Bounds link sprawl; hosts revoke unused links first.
   */
  CHAT_ROOM_GUEST_INVITE_LINK_ACTIVE_LIMIT: 10,

  /**
   * Maximum shareable guest invite links one creator may mint per hour
   * (across rooms). Complements the per-room active cap.
   */
  CHAT_ROOM_GUEST_INVITE_LINK_CREATE_PER_HOUR: 10,

  /** Maximum live pending member invitations stored for one vendor. */
  VENDOR_MEMBER_INVITE_PENDING_LIMIT: 100,

  /**
   * Maximum vendor member invitations one inviter may create per hour (across
   * vendors). Complements the per-vendor pending cap for spam protection.
   */
  VENDOR_MEMBER_INVITE_CREATE_PER_HOUR: 30,

  /**
   * Maximum self-service vendors one user may administer. Vendor create is a
   * one-time cold-start for private Coworker registration, not a namespace to
   * farm; platform admins create additional vendors via /v1/admin/vendors.
   */
  SELF_SERVICE_VENDOR_LIMIT_PER_USER: 1,

  /** Maximum length of a vendor logo string (URL or path). */
  VENDOR_LOGO_MAX_LENGTH: 2048,

  /** Maximum organizations per user */
  ORGANIZATION_LIMIT: 100,

  /** Minimum password length */
  PASSWORD_MIN_LENGTH: 8,

  /** Maximum password length */
  PASSWORD_MAX_LENGTH: 256,

  /**
   * Maximum length for user-supplied task and job names. Generous sanity
   * ceiling (not a product limit) to bound abuse: oversized names would bloat
   * storage, break UI rendering, and exceed downstream payload caps (e.g. Ably
   * notification messages embed the job name).
   */
  NAME_MAX_LENGTH: 10_000,

  /** Default pagination limit */
  DEFAULT_PAGINATION_LIMIT: 20,

  /** Maximum pagination limit */
  MAX_PAGINATION_LIMIT: 100,

  /**
   * GET /v1/chats/rooms/{id}/stream/messages (AI SDK UI history): default page size until the chat UI adds cursor navigation.
   * Same cap is used when merging server-side history on POST /v1/chats/rooms/{id}/stream.
   */
  CHAT_UI_MESSAGES_DEFAULT_LIMIT: 200,

  /** Maximum messages returned in one GET /v1/chats/rooms/{id}/stream/messages page (matches current UI expectation). */
  CHAT_UI_MESSAGES_MAX_LIMIT: 200,

  /** Maximum upload size for direct user file uploads (100 MB) */
  USER_UPLOAD_MAX_SIZE_BYTES: FILE_UPLOAD_MAX_SIZE_BYTES,

  /** Maximum size of a DESIGN.md document accepted for storage (1MB) */
  DESIGN_MD_MAX_SIZE_BYTES: 1024 * 1024,

  /** Minimum chargeable credits */
  MIN_CHARGEABLE_CREDITS: 1e-10,
} as const;

/** User-Agent sent with outbound webhook requests from the Core API. */
export const WEBHOOK_USER_AGENT = "Sokosumi-Core-API/1.0";

/** Outbound webhook request timeout for Core API callers (from `@sokosumi/utils`). */
export const WEBHOOK_TIMEOUT_MS = DEFAULT_WEBHOOK_TIMEOUT_MS;

/**
 * Cryptographic algorithms and settings
 */
export const CRYPTO = {
  /** Hash algorithm for image deduplication */
  IMAGE_HASH_ALGORITHM: "sha256",
} as const;

/**
 * Storage paths and directories
 */
export const STORAGE = {
  /** Default directory for image uploads */
  IMAGES_UPLOAD_DIR: "images",
} as const;
