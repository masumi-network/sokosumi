import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

// Define the Step interface
interface Step {
  title: string;
  description: string;
}

export default function HowItWorks() {
  const t = useTranslations("Landing.HowItWorks");
  return (
    <>
      {/* Responsive grid - horizontal on md+ screens, vertical on smaller screens */}
      <div className="mb-10 grid grid-cols-1 gap-8 text-left md:grid-cols-3">
        {/* Iterate over steps from translation file */}
        {(t.raw("steps") as Step[]).map((step, i) => (
          <div key={i} className="flex h-full w-full flex-col items-start">
            <div className="flex h-full w-full flex-col">
              <h3 className="mb-3 text-xl font-semibold">{step.title}</h3>
              <p className="mb-4 grow text-gray-600">{step.description}</p>
              <div className="relative h-48 w-full overflow-hidden rounded-lg">
                <Image
                  src="/placeholder.svg"
                  alt={`${step.title} illustration`}
                  fill
                  className="object-cover"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Explore Gallery Button */}
      <div className="flex justify-start">
        <Link href="/gallery">
          <Button>{t("button")}</Button>
        </Link>
      </div>
    </>
  );
}
