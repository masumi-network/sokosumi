"use client";

import { usePathname } from "next/navigation";

import {
  SignInButton,
  SignUpButton,
} from "@/landing/(auth)/components/buttons";
import { cn } from "@/lib/utils";

interface AuthButtonsProps {
  containerClassName?: string | undefined;
}

export default function AuthButtons({ containerClassName }: AuthButtonsProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/login"))
    return (
      <SignUpButton className="bg-accent text-accent-foreground hover:bg-accent/90" />
    );

  if (pathname.startsWith("/register"))
    return (
      <SignInButton className="bg-accent text-accent-foreground hover:bg-accent/90" />
    );

  return (
    <div className={cn("flex items-center gap-4", containerClassName)}>
      <SignInButton
        className="bg-accent text-accent-foreground hover:bg-accent/90"
        variant="default"
      />
    </div>
  );
}
