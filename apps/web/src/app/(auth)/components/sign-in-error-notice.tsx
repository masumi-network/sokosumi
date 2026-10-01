import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";

// Codes Better Auth appends to the `errorCallbackURL` of a social sign-in
// (see `buildAuthErrorCallbackUrl`). Any other code gets the generic message.
const SIGN_IN_ERROR_MESSAGE_KEYS = new Map<
  string,
  "accountNotLinked" | "cancelled"
>([
  // The email belongs to an account whose address is not verified yet.
  ["account_not_linked", "accountNotLinked"],
  // The person cancelled at Google or Microsoft.
  ["access_denied", "cancelled"],
]);

interface SignInErrorNoticeProps {
  error: string | undefined;
}

/** Explains why a social sign-in brought the person back. */
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
