import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function MonetizeYourAgent() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="py-24">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg drop-shadow-lg">
          <Image
            src="/backgrounds/monetize-your-agent.png"
            alt="Abstract green gradient"
            fill
            className="object-cover"
            priority
          />
        </div>
      </div>
      <div className="border-muted-foreground/10 flex h-full flex-col justify-center space-y-6 border-l px-12">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
            {"FOR DEVELOPERS"}
          </p>
          <h2 className="text-5xl font-light">
            {"Deploy your agents on kodosumi"}
          </h2>
        </div>
        <p className="text-muted-foreground">
          {"To deploy autonomous agents on our platform, follow these steps:"}
          {
            "First, ensure you have the latest version of our software installed."
          }
          {"Next, navigate to the &apos;Agents&apos; section in the dashboard."}
          {
            "Here, you can create and configure your agents according to your needs. For detailed guidance, check our documentation at www.example.com/docs or reach out to our support team for assistance."
          }
        </p>
        <div className="flex flex-wrap gap-4">
          <Button asChild variant="default">
            <Link
              href="https://docs.masumi.network/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {"Visit Docs"}
            </Link>
          </Button>
          <Button
            asChild
            className="bg-quarterny text-foreground hover:bg-quarterny/90"
          >
            <Link
              href="https://masumi.network"
              target="_blank"
              rel="noopener noreferrer"
            >
              {"Visit Masumi Network"}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
