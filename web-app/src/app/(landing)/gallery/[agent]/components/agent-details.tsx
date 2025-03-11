import Image from "next/image";
import { useTranslations } from "next-intl";

import BadgeCloud from "@/components/badge-cloud";
import { Button } from "@/components/ui/button";

interface AgentDetailsProps {
  title: string;
  description: string;
  author: string;
  image: string;
  price: number;
  tags: string[];
}

export default function AgentDetails({
  title,
  description,
  author,
  image,
  price,
  tags,
}: AgentDetailsProps) {
  const t = useTranslations("Landing.Gallery.Agent");
  return (
    <>
      <div className="flex h-48 w-full overflow-hidden">
        <div className="relative h-full w-48">
          <Image
            src={image}
            alt={title}
            fill
            className="rounded-md object-cover"
            priority
          />
        </div>
        <div className="flex flex-1 flex-col px-6 py-2">
          <div>
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-muted-foreground line-clamp-1">
              {t("byAuthor", { author })}
            </p>
            <p className="pt-1 text-sm font-medium">
              {t("pricing", { price })}
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Button variant="default" size="lg">
                {t("hire")}
              </Button>
              <Button variant="outline" size="lg">
                {t("share")}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <BadgeCloud tags={tags} />
      <div className="text-muted-foreground">
        <p>{description}</p>
      </div>
    </>
  );
}
