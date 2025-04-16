import Image from "next/image";
import { useTranslations } from "next-intl";

interface UserProps {
  image: string;
  quote: string;
  name: string;
  position: string;
  company: string;
  index: number;
}

const User = ({ image, quote, name, position, company, index }: UserProps) => (
  <div className="flex-start stretch border-foreground/10 flex gap-12 border-t py-4">
    <div className="relative flex w-[77px] min-w-[77px] flex-col justify-between">
      <Image
        src={image}
        alt={name}
        className="h-[96px] w-[77px] object-cover"
        width={77}
        height={96}
      />
      <span className="text-muted-foreground text-sm">
        {index < 10 ? "0" : ""}
        {index + 1}
      </span>
    </div>
    <div className="flex w-full flex-col gap-16">
      <p className="text-3xl">{`"${quote}"`}</p>
      <div className="text-sm">
        <div>{name}</div>
        <div className="text-muted-foreground">
          {position} {"at"} {company}
        </div>
      </div>
    </div>
  </div>
);

export default function WhatOurUsersSay() {
  const t = useTranslations("Landing.Page.WhatOurUsersSay");
  const users = [
    {
      image: "/images/user-1.png",
    },
    {
      image: "/images/user-2.png",
    },
  ];

  const usersMap = users.map((user, index) => {
    return {
      ...user,
      quote: t(`users.${index?.toString()}.quote`),
      name: t(`users.${index?.toString()}.name`),
      position: t(`users.${index?.toString()}.position`),
      company: t(`users.${index?.toString()}.company`),
    };
  });

  return (
    <div className="relative flex w-full flex-col gap-12">
      <h2 className="text-left text-5xl font-light">{t("title")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {usersMap.map((user, index) => (
          <User key={index} {...user} index={index} />
        ))}
      </div>
    </div>
  );
}
