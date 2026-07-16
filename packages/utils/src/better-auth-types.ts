/**
 * Client-safe Better Auth protocol shapes for web and other consumers.
 *
 * **SOK-588 documented exception** — session/account types intentionally live in
 * `@sokosumi/utils` (not `packages/auth-types`, not generated Core `/v1` DTOs).
 *
 * - Shapes match Core Better Auth `/auth` JSON — **not** Core REST entity DTOs
 *   (`Agent`, `Job`, `OrganizationRecord`, … from `/v1`).
 * - **Not** Prisma `Session` / `Account` models from `@sokosumi/database`.
 * - Kept next to cookie, public-URL, and client-schema helpers; parity tests
 *   guard `SessionUser` keys against `betterAuthUserAdditionalFields` (client
 *   schema), not live Core `/auth` HTTP payloads.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  termsAccepted: boolean;
  marketingOptIn: boolean;
  notificationsOptIn?: boolean | null;
  logo?: string | null;
  metadata?: string | null;
  stripeCustomerId?: string | null;
  onboardingCompleted: boolean;
  role?: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date | string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
  activeOrganizationId?: string | null;
}

export interface Session {
  session: SessionRecord;
  user: SessionUser;
}

export interface Account {
  id: string;
  providerId: string;
  accountId: string;
  userId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: Date | string | null;
  refreshTokenExpiresAt?: Date | string | null;
  scope?: string | null;
  password?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
