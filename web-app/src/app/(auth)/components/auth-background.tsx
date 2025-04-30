import Image from "next/image";

import { KanjiLogo, ThemedLogo } from "@/components/masumi-logos";

export default function AuthBackground() {
  return (
    <div className="relative h-full w-full">
      <Image
        alt="auth-bg"
        src="/backgrounds/visuals/moody-1.png"
        fill
        className="rounded-xl object-cover"
        sizes="50vw"
      />
      <div className="pointer-events-none absolute right-4 bottom-4">
        <ThemedLogo LogoComponent={KanjiLogo} />
      </div>
    </div>
  );
}
