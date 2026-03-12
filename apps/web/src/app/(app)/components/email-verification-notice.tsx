import { getTranslations } from "next-intl/server";

import TopNotice, { TOP_NOTICE_ACTION_CLASS_NAME } from "./top-notice";
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
    <TopNotice
      title={t("title")}
      description={t("description")}
      action={
        <VerifyEmailButton
          email={email}
          label={t("button")}
          variant="outline"
          className={TOP_NOTICE_ACTION_CLASS_NAME}
        />
      }
    />
  );
}
