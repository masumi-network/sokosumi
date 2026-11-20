import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { useSession } from "@/lib/auth/auth.client";
import type { SeoOwner } from "@/lib/seo/owner";
import { useSeoConsoleExports } from "./use-seo-console-exports";

export function SeoConsoleExportActions({
  owner,
  taskId,
}: {
  owner: SeoOwner;
  taskId: string;
}) {
  const { data: session } = useSession();
  return session?.user.id ? (
    <PrivateExportActions
      owner={owner}
      taskId={taskId}
      userId={session.user.id}
      organizationId={session.session.activeOrganizationId ?? null}
    />
  ) : null;
}

function PrivateExportActions({
  owner,
  taskId,
  userId,
  organizationId,
}: {
  owner: SeoOwner;
  taskId: string;
  userId: string;
  organizationId: string | null;
}) {
  const t = useSeoResultTranslations("App.Seo.discovery");
  const { reports } = useSeoConsoleExports(
    owner,
    taskId,
    userId,
    organizationId,
  );
  if (reports.isFetching || reports.isError) return null;
  const dated = reports.data?.flatMap((report) =>
    (report.actions ?? []).map((action) => ({ action, date: report.date })),
  );
  if (!dated?.length) return null;
  return (
    <section lang="en" className="space-y-2 text-sm">
      <h4 className="font-medium">{t("exportActions")}</h4>
      <ul className="space-y-2">
        {dated.map(({ action, date }) => (
          <li key={action.id}>
            <p className="font-medium">{action.title}</p>
            {action.subject && (
              <p className="break-all text-muted-foreground">
                {action.subject}
              </p>
            )}
            <p>{action.why}</p>
            <p>{action.nextCheck}</p>
            <p className="text-muted-foreground">{t("exportDate", { date })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
