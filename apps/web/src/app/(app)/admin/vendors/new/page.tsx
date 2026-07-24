import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { VendorForm } from "@/components/admin/vendors/vendor-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "New vendor",
  description: "Create a marketplace vendor",
};

export default async function AdminNewVendorPage() {
  const t = await getTranslations("App.Admin.Vendors");

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("createTitle")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("createDescription")}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/vendors">{t("backToList")}</Link>
          </Button>
        </div>

        <VendorForm mode="create" />
      </div>
    </div>
  );
}
