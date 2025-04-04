import { useTranslations } from "next-intl";

import TypedLink from "@/components/typed-link";
import { Button } from "@/components/ui/button";

export function SignInButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Landing.Auth.Words");

  return (
    <TypedLink route={{ pathname: "/signin" }}>
      <Button {...props}>{t("signIn")}</Button>
    </TypedLink>
  );
}

export function SignUpButton(props: React.ComponentProps<typeof Button>) {
  const t = useTranslations("Landing.Auth.Words");
  return (
    <TypedLink route={{ pathname: "/signup" }}>
      <Button {...props}>{t("signUp")}</Button>
    </TypedLink>
  );
}
