import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { getSession } from "@/lib/auth/auth.server";
import { readFundraisingPipeline } from "@/lib/services/fundraising.server";
import { FundraisingBoard } from "./components/fundraising-board";

// Workspace-scoped, authenticated and gated to a few organizations.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Fundraising");
  return { title: t("title"), description: t("description") };
}

/**
 * The raise: the Investors list as a pipeline. Not in the sidebar; it exists
 * only for organizations Core lists, and reads as a missing page to others.
 */
export default async function FundraisingPage() {
  await connection();
  const session = await getSession();
  if (!session) return notFound();
  const pipeline = await readFundraisingPipeline();
  if (!pipeline) return notFound();
  const t = await getTranslations("App.Fundraising");
  return (
    <WorkspacePageShell title={t("title")}>
      <FundraisingBoard initialData={pipeline} />
    </WorkspacePageShell>
  );
}
