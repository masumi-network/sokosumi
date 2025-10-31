import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function SignInButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Auth.Words");

  return (
    <Button {...props} asChild variant="primary">
      <Link href="/signin">{t("signIn")}</Link>
    </Button>
  );
}

export function SignUpButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Auth.Words");
  return (
    <Button {...props} asChild variant="primary">
      <Link href="/signup">{t("signUp")}</Link>
    </Button>
  );
}
