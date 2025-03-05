import Image from "next/image";

interface BrandLogosProps {
  title?: string;
  logos?: {
    name: string;
    url: string;
    image: string;
  }[];
}

export default function TrustedPartners({
  title = "Endorsed by Leading Brands:",
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
      <div className="mt-2">
        {title && <h3 className="text-sm font-light">{title}</h3>}
      </div>

      <div className="flex flex-nowrap items-center justify-center gap-12 overflow-x-auto">
        {logos.map((logo) => (
          <a
            key={logo.name}
            href={logo.url}
            className="transition-all duration-300 hover:scale-105 hover:opacity-80 focus:outline-none"
            aria-label={logo.name}
          >
            <Image
              src={logo.image || "/placeholder.svg"}
              alt={`${logo.name} logo`}
              width={0}
              height={0}
              className="w-auto object-contain"
              style={{
                width: "auto",
                height: "auto",
              }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
