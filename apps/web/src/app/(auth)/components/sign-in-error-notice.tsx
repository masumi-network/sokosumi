import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";

type SignInErrorMessageKey =
  | "accountNotLinked"
  | "cancelled"
  | "expired"
  | "clientMisconfigured";

// Codes Better Auth appends to the `errorCallbackURL` of a social sign-in
// (see `buildSocialCallbackUrls`), or to Core's `onAPIError.errorURL`, the
// `/auth/error` page, when the failure has no callback. Any other code gets
// the generic message.
const SIGN_IN_ERROR_MESSAGE_KEYS = new Map<string, SignInErrorMessageKey>([
  // The email belongs to an account whose address is not verified yet.
  ["account_not_linked", "accountNotLinked"],
  // The person cancelled at Google or Microsoft.
  ["access_denied", "cancelled"],
  // The social sign-in's state is gone: it took over ten minutes, or the
  // callback reached another browser.
  ["state_mismatch", "expired"],
  ["state_not_found", "expired"],
  ["state_invalid", "expired"],
  // Core refused an OAuth client's authorize request before it could trust
  // the client's redirect URI, so only the app's developer can fix it.
  ["invalid_client", "clientMisconfigured"],
  ["client_disabled", "clientMisconfigured"],
  ["unauthorized_client", "clientMisconfigured"],
  ["invalid_redirect", "clientMisconfigured"],
  ["unsupported_response_type", "clientMisconfigured"],
  ["unsupported_prompt_select_account", "clientMisconfigured"],
]);

interface SignInErrorNoticeProps {
  error: string | undefined;
}

/** Explains why a sign-in brought the person back. */
export default function SignInErrorNotice({ error }: SignInErrorNoticeProps) {
  const t = useTranslations("Auth.SignInError");
  if (!error) {
    return null;
  }

  const messageKey = SIGN_IN_ERROR_MESSAGE_KEYS.get(error) ?? "generic";

  return (
    <Alert variant="destructive">
      <AlertDescription>{t(messageKey)}</AlertDescription>
    </Alert>
  );
}
