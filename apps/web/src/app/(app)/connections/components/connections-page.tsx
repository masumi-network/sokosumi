import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/utils";

import { McpPageContent } from "./mcp-page-content";

export async function ConnectionsPage() {
  const [session, t] = await Promise.all([
    getSession(),
    getTranslations("App.MCP"),
  ]);

  if (!session?.user) {
    return null;
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="space-y-6">
          <div>
            <Suspense fallback={<div>{t("loading")}</div>}>
              <McpPageContent
                activeOrganizationId={
                  session.session.activeOrganizationId ?? null
                }
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
