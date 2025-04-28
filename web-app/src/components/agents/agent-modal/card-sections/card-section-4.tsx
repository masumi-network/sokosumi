import Link from "next/link";
import { useTranslations } from "next-intl";

import { AgentWithRelations, getAgentLegal } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection4({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card4");
  const legal = getAgentLegal(agent);

  if (!legal) {
    return null;
  }

  return (
    <CardSection>
      <div>
        <p className="mb-2 text-xs uppercase">{t("title")}</p>
        <div className="flex flex-wrap">
          {legal?.privacyPolicy && (
            <Link
              href={legal.privacyPolicy}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("privacyPolicy")}
            </Link>
          )}
          {legal?.terms && (
            <Link
              href={legal.terms}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("terms")}
            </Link>
          )}
          {legal?.other && (
            <Link
              href={legal.other}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("other")}
            </Link>
          )}
        </div>
      </div>
    </CardSection>
  );
}

export { CardSection4 };
