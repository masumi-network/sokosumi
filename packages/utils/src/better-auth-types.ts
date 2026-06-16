/**
 * Client-safe Better Auth session types for web (and other consumers).
 * Shapes match Core `/auth` JSON responses — not tied to web `auth.ts`.
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
