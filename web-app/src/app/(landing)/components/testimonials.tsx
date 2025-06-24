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
  <div className="flex-start stretch border-foreground/10 flex gap-6 border-t py-4 md:gap-12">
    <div className="relative flex w-[77px] min-w-[77px] flex-col justify-between">
      <Image
        src={image}
        alt={name}
        className="h-[66px] w-[53px] rounded-lg object-cover md:h-[96px] md:w-[77px]"
        width={77}
        height={96}
      />
      <span className="text-muted-foreground text-xs md:text-sm">
        {index < 10 ? "0" : ""}
        {index + 1}
      </span>
    </div>
    <div className="flex w-full flex-col gap-8 md:gap-16">
      <p className="text-xl md:text-3xl">{`"${quote}"`}</p>
      <div className="text-xs md:text-sm">
        <div>{name}</div>
        <div className="text-muted-foreground">
          {position} {"at"} {company}
        </div>
      </div>
    </div>
  </div>
);

export default function Testimonials() {
  const t = useTranslations("Landing.Page.Testimonials");
  const users = [
    {
      image: "/testimonials/frederik-gregaard.jpeg",
    },
    {
      image: "/testimonials/mock-user.png",
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
    <div className="flex flex-col gap-8 md:gap-12">
      <h2 className="text-left text-2xl font-light md:text-5xl">
        {t("title")}
      </h2>
      <div className="grid gap-12 md:grid-cols-2 md:gap-4">
        {usersMap.map((user, index) => (
          <User key={index} {...user} index={index} />
        ))}
      </div>
    </div>
  );
}
