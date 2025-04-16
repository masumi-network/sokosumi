import Link from "next/link";
import { FaDiscord, FaXTwitter } from "react-icons/fa6";

import { Button } from "@/components/ui/button";

export function JoinOurCommunity() {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="opacity absolute inset-0 bg-[url('/backgrounds/footer-image.png')] bg-cover bg-center bg-no-repeat" />
      <div className="bg-background/70 relative px-6 py-12 sm:px-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-2 text-xs tracking-wider uppercase">
            {"WE ARE ONLINE"}
          </p>
          <h2 className="mb-8 text-5xl font-light sm:text-4xl">
            {"Join the Community"}
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button variant="default" asChild>
              <Link
                href="https://discord.com/invite/aj4QfnTS92"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaDiscord />
                <span>{"Discord"}</span>
              </Link>
            </Button>
            <Button
              className="bg-quarterny text-foreground hover:bg-quarterny/90"
              asChild
            >
              <Link
                href="https://x.com/MasumiNetwork"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaXTwitter />
                <span>{"Twitter"}</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
