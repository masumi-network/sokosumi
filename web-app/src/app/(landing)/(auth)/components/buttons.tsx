import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function SignInButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Landing.Auth.Words");

  return (
    <Link href="/login">
      <Button {...props}>{t("signIn")}</Button>
    </Link>
  );
}

export function SignUpButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Landing.Auth.Words");
  return (
    <Link href="/register">
      <Button {...props}>{t("signUp")}</Button>
    </Link>
  );
}
