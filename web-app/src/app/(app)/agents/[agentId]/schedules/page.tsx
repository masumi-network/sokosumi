import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/lib/auth/utils";
import { agentRepository, jobScheduleRepository } from "@/lib/db/repositories";

interface Params {
  params: Promise<{ agentId: string }>;
}

export default async function AgentSchedulesPage({ params }: Params) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { agentId } = await params;

  const agent = await agentRepository.getAgentWithRelationsById(agentId);
  if (!agent) {
    return notFound();
  }

  const schedules =
    await jobScheduleRepository.getScheduleJobsByAgentIdAndContext(
      agentId,
      session.user.id,
      session.session.activeOrganizationId ?? null,
    );

  const t = await getTranslations("App.Agents.Jobs.CreateJob.Scheduler");

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-xl font-semibold">{t("schedulesTitle")}</h1>
      <div className="mt-4 space-y-3">
        {schedules.map((s) => (
          <div key={s.id} className="rounded-md border p-3">
            <div className="text-sm">
              {s.agent.name}{" "}
              <span className="text-muted-foreground">
                {s.isActive ? "(Active)" : "(Inactive)"}
              </span>
            </div>
            <div className="text-muted-foreground text-xs">
              <p>
                {`Last: ${s.lastRunAt?.toISOString() ?? "—"} (${s.timezone})`}
              </p>
              <p>
                {`Next: ${s.nextRunAt?.toISOString() ?? "—"} (${s.timezone})`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
