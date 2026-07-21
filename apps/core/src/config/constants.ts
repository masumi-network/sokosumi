import { DEFAULT_WEBHOOK_TIMEOUT_MS } from "@sokosumi/utils";

/**
 * Application constants for the Core API
 * Centralized configuration values for better maintainability
 */

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
} as const;

/**
 * Rate limits and capacity constraints
 */
export const LIMITS = {
  /** Maximum API key requests per minute */
  API_KEY_MAX_REQUESTS_PER_MINUTE: 100,

  /** Maximum organization invitations per organization */
  ORGANIZATION_INVITATION_LIMIT: 100,

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
   * GET /v1/chat (AI SDK UI history): default page size until the chat UI adds cursor navigation.
   * Same cap is used when merging server-side history on POST /v1/chat.
   */
  CHAT_UI_MESSAGES_DEFAULT_LIMIT: 200,

  /** Maximum messages returned in one GET /v1/chat page (matches current UI expectation). */
  CHAT_UI_MESSAGES_MAX_LIMIT: 200,

  /** Maximum upload size for direct user file uploads (1GB) */
  USER_UPLOAD_MAX_SIZE_BYTES: 1024 * 1024 * 1024,

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

  /** Root directory for user file uploads */
  USER_UPLOADS_DIR: "users",

  /** Directory for stored DESIGN.md documents */
  DESIGN_MD_UPLOAD_DIR: "design-md",

  /** Root directory for orchestrator image uploads */
  ORCHESTRATOR_IMAGES_DIR: "orchestrators",
} as const;
