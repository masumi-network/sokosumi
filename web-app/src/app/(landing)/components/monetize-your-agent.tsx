import Image from "next/image";

import { KodosumiLogo, MasumiLogo } from "@/components/masumi-logos";

import { GitHubButton, MasumiButton } from "./social-button";

export function MonetizeYourAgent() {
  return (
    <section className="container py-4">
      <div className="flex flex-col items-center gap-8 md:flex-row">
        {/* Content Section */}
        <div className="w-full space-y-6 md:w-1/2">
          <h2 className="text-5xl font-bold tracking-tighter">
            Deploy your Agents
          </h2>
          <p className="text-lg text-muted-foreground">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum
            vehicula ex eu nisi dictum, a facilisis mauris tincidunt. Nulla
            facilisi. Cras vel justo vel libero lacinia ultricies. Suspendisse
            potenti. Donec nec odio vel mi vulputate malesuada. Aenean
            tincidunt, nibh ut interdum luctus, sapien tortor laoreet nisi, eget
            malesuada odio odio non purus. Sed ut perspiciatis unde omnis iste
            natus error sit voluptatem.
          </p>

          {/* Masumi Logos */}
          <div className="flex flex-col items-end gap-6">
            <KodosumiLogo />
            <MasumiLogo />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-4">
            <MasumiButton />
            <GitHubButton url="https://github.com/masumi-network/masumi-payment-service">
              Masumi Payment
            </GitHubButton>
            <GitHubButton url="https://github.com/masumi-network/masumi-registry-service">
              Masumi Registry
            </GitHubButton>
          </div>
        </div>

        {/* Image Section */}
        <div className="w-full md:w-1/2">
          <div className="relative mx-auto aspect-square w-full max-w-md">
            <Image
              src="/placeholder.svg"
              alt="Community Placeholder"
              fill
              className="rounded-lg object-cover"
              priority
            />
          </div>
        </div>
      </div>
    </section>
  );
}
