import Image from "next/image";

import { DiscordButton, XButton } from "./social-button";

export function MonetizeYourAgent() {
  return (
    <section className="container mx-auto px-4 py-4">
      <div className="flex flex-col items-center gap-8 md:flex-row">
        {/* Content Section */}
        <div className="w-full space-y-6 md:w-1/2">
          <p className="text-lg text-muted-foreground">
            Connect with like-minded individuals, share experiences, and be part
            of our growing community. Follow us on social media to stay updated
            with the latest news and events.
          </p>

          {/* Social Links */}
          <div className="flex gap-4">
            <XButton />
            <DiscordButton />
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
