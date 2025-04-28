import { useTranslations } from "next-intl";

import { AgentWithRelations, getAgentAuthorName } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection6({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card6");

  return (
    <CardSection>
      <div className="w-full">
        <div className="mb-2 flex flex-col gap-0.5">
          <p className="mb-2 text-xs uppercase">{t("title")}</p>
          <p className="text-lg font-semibold">
            {t("subtitle", { author: getAgentAuthorName(agent) })}
          </p>
        </div>
      </div>
    </CardSection>
  );
}

export { CardSection6 };
