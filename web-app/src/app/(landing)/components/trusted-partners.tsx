import Image from "next/image";

import { HorizontalScrollList } from "./horizontal-scroll-list";

interface BrandLogosProps {
  title?: string;
  logos?: {
    name: string;
    url: string;
    image: string;
  }[];
}

export default function TrustedPartners({
  title = "Trusted by Brands",
  logos = [
    {
      name: "Delonghi",
      url: "https://www.delonghi.com",
      image: "/brands/Delonghi.svg",
    },
    {
      name: "BMW",
      url: "https://www.bmw.com",
      image: "/brands/BMW.svg",
    },
    {
      name: "Bosch",
      url: "https://www.bosch.com",
      image: "/brands/Bosch.svg",
    },
    {
      name: "Lufthansa",
      url: "https://www.lufthansa.com",
      image: "/brands/Lufthansa.svg",
    },
    {
      name: "Microsoft",
      url: "https://www.microsoft.com",
      image: "/brands/Microsoft.svg",
    },
    {
      name: "Penny",
      url: "https://www.penny.de",
      image: "/brands/Penny.svg",
    },
  ],
}: BrandLogosProps) {
  return (
    <div className="container mx-auto">
      <div className="mt-2 space-y-4">
        {title && <h3 className="text-3xl font-bold">{title}</h3>}
      </div>

      <HorizontalScrollList>
        {logos.map((logo) => (
          <a
            key={logo.name}
            href={logo.url}
            className="flex h-32 items-center justify-center px-6 transition-all duration-300 hover:scale-105 hover:opacity-80 focus:outline-none"
            aria-label={logo.name}
          >
            <Image
              src={logo.image || "/placeholder.svg"}
              alt={`${logo.name} logo`}
              width={0}
              height={32}
              className="h-auto w-auto object-contain"
              priority
            />
          </a>
        ))}
      </HorizontalScrollList>
    </div>
  );
}
