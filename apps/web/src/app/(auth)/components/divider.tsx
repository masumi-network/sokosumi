import { useTranslations } from "next-intl";

export default function Divider() {
  const t = useTranslations("Auth.SocialButtons");

  return (
    <div className="flex items-center justify-between gap-2">
      <hr className="h-0 flex-1 border-0 border-t border-border" />
      <span className="text-xs text-muted-foreground">{t("orDivider")}</span>
      <hr className="h-0 flex-1 border-0 border-t border-border" />
    </div>
  );
}
