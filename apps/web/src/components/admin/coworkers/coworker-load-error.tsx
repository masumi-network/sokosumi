import { getTranslations } from "next-intl/server";

interface CoworkerLoadErrorProps {
  message?: string | null;
}

export async function CoworkerLoadError({ message }: CoworkerLoadErrorProps) {
  const t = await getTranslations("App.Admin.Coworkers");

  return (
    <p className="text-destructive text-sm">{message ?? t("loadFailed")}</p>
  );
}
