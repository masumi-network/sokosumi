/**
 * Application constants for the Core API
 * Centralized configuration values for better maintainability
 */

/**
 * Time durations in seconds
 */
export const TIME = {
  /** Webhook request timeout (10 seconds) */
  WEBHOOK_TIMEOUT: 10,

  /** Session cookie cache max age (5 minutes) */
  SESSION_COOKIE_CACHE_MAX_AGE: 5 * 60,

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
} as const;

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

export const CREDIT = {
  /** Fee percentage points (5%) */
  FEE_PERCENTAGE_POINTS: 5,

  /** Minimum fee credits (1 credit) */
  MIN_FEE_CREDITS: 1,
} as const;
