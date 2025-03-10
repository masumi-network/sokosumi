import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function SignInButton() {
  const t = useTranslations("Authentication");

  return (
    <Link href="/signin">
      <Button variant="outline">{t("SignIn")}</Button>
    </Link>
  );
}

export function SignUpButton() {
  const t = useTranslations("Authentication");
  return (
    <Link href="/signup">
      <Button>{t("SignUp")}</Button>
    </Link>
  );
}
