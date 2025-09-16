import { useTranslations } from "next-intl";

interface McpKeyNotesProps {
  isKeyExisting: boolean;
}

export function McpKeyNotes({ isKeyExisting }: McpKeyNotesProps) {
  const t = useTranslations("App.MCP");

  if (!isKeyExisting) {
    return null;
  }

  return (
    <>
      <p className="text-muted-foreground text-xs">{t("existingKeyNote")}</p>
      <p className="text-muted-foreground mt-2 text-xs">
        {t("existingKeyNote2")}
      </p>
    </>
  );
}
