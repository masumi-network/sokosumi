import { useTranslations } from "next-intl";

import ResetPasswordForm from "./components/form";
import ResetPasswordHeader from "./components/header";

export default function ResetPasswordPage() {
  const t = useTranslations("Auth.Pages.ResetPassword");

  return (
    <div className="flex flex-1 flex-col">
      <ResetPasswordHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <ResetPasswordForm />
      </div>
    </div>
  );
}
