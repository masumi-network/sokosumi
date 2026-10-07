import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";

import { auth } from "@/lib/auth.js";

/**
 * The issuer `{baseURL}/auth`'s RFC 8414 metadata. Core serves it under the
 * issuer and at the root `.well-known` path, so both read this one handler.
 */
export const handleOAuthAuthServerMetadata =
  oauthProviderAuthServerMetadata(auth);

export const handleOpenIdConfiguration =
  oauthProviderOpenIdConfigMetadata(auth);
