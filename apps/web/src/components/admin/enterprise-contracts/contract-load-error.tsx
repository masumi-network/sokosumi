import { getTranslations } from "next-intl/server";

interface ContractLoadErrorProps {
  message?: string | null;
}

export async function ContractLoadError({ message }: ContractLoadErrorProps) {
  const t = await getTranslations("App.Admin.EnterpriseContracts");

  return (
    <p className="text-destructive text-sm">{message ?? t("loadFailed")}</p>
  );
}
