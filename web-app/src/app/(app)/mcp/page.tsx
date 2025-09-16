import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/utils";

import { McpPageContent } from "./components/mcp-page-content";

export default async function McpPage() {
  const session = await getSession();
  const t = await getTranslations("App.MCP");

  if (!session?.user) {
    return null;
  }

  return (
    <div className="max-w-3xl p-6">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-light">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        <Suspense fallback={<div>{"Loading..."}</div>}>
          <McpPageContent
            activeOrganizationId={session.session.activeOrganizationId ?? null}
          />
        </Suspense>
      </div>
    </div>
  );
}
