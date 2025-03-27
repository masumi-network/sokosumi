import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { LandingRoute } from "@/types/routes";

export function SignInButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Auth.Words");

  return (
    <Link href={LandingRoute.SignIn}>
      <Button {...props}>{t("signIn")}</Button>
    </Link>
  );
}

export function SignUpButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Auth.Words");
  return (
    <Link href={LandingRoute.SignUp}>
      <Button {...props}>{t("signUp")}</Button>
    </Link>
  );
}
