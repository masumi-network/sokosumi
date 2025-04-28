import Link from "next/link";
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { AgentWithRelations, getAgentLegal } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection5({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card5");
  const legal = getAgentLegal(agent);

  if (!legal) {
    return null;
  }

  return (
    <CardSection>
      <div>
        <p className="mb-2 text-xs uppercase">{t("title")}</p>
        <div className="flex flex-wrap gap-4">
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

function CardSection5Skeleton() {
  return (
    <CardSection>
      <div>
        <Skeleton className="mb-2 h-4 w-12" />
        <div className="flex flex-wrap gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-24" />
          ))}
        </div>
      </div>
    </CardSection>
  );
}

export { CardSection5, CardSection5Skeleton };
