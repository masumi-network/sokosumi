import Image from "next/image";

import { DiscordButton, XButton } from "./components/social-button";

export function JoinOurCommunity() {
  return (
    <section className="container py-4">
      <div className="flex flex-col items-center gap-8 md:flex-row">
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

        {/* Content Section */}
        <div className="w-full space-y-6 md:w-1/2">
          <h2 className="text-5xl font-bold tracking-tighter">We are online</h2>
          <p className="text-muted-foreground text-lg">
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
      </div>
    </section>
  );
}
