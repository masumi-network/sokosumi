import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function SignInButton() {
  const t = useTranslations("Auth.Words");

  return (
    <Link href="/signin">
      <Button variant="outline">{t("signIn")}</Button>
    </Link>
  );
}

export function SignUpButton() {
  const t = useTranslations("Auth.Words");
  return (
    <Link href="/signup">
      <Button>{t("signUp")}</Button>
    </Link>
  );
}
