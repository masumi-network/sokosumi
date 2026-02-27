import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import VerifyEmailButton from "./verify-email-button";

interface EmailVerificationNoticeProps {
  email: string | null | undefined;
  emailVerified: boolean;
}

export default async function EmailVerificationNotice({
  email,
  emailVerified,
}: EmailVerificationNoticeProps) {
  if (emailVerified || !email) {
    return null;
  }

  const t = await getTranslations("App.EmailVerificationNotice");

  return (
    <div className="sticky top-0 z-10 mb-4">
      <Alert className="border-semantic-warning-tertiary bg-semantic-warning-quinary text-semantic-warning">
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle className="text-semantic-warning">{t("title")}</AlertTitle>
        <AlertDescription className="text-semantic-warning">
          <div className="flex flex-col gap-2">
            <p>{t("description")}</p>
            <VerifyEmailButton
              email={email}
              label={t("button")}
              variant="outline"
              className="border-semantic-warning-tertiary text-semantic-warning hover:bg-semantic-warning-quinary hover:text-semantic-warning self-start bg-transparent"
            />
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
