import { useTranslations } from "next-intl";

interface DividerProps {
  labelKey: "passwordDivider" | "emailDivider";
}

export default function Divider({ labelKey }: DividerProps) {
  const t = useTranslations("Auth.SocialButtons");

  return (
    <div className="flex items-center justify-between gap-2">
      <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
      <span className="text-xs text-gray-400 uppercase">{t(labelKey)}</span>
      <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
    </div>
  );
}
