"use client";

import { usePathname } from "next/navigation";

import { SignInButton, SignUpButton } from "@/auth/components/buttons";
import { cn } from "@/lib/utils";

interface AuthButtonsProps {
  containerClassName?: string | undefined;
}

export default function AuthButtons({ containerClassName }: AuthButtonsProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/login")) return <SignUpButton />;

  if (pathname.startsWith("/register")) return <SignInButton />;

  return (
    <div className={cn("flex items-center gap-4", containerClassName)}>
      <SignInButton />
    </div>
  );
}
