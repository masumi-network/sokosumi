"use client";

import { usePathname } from "next/navigation";

import {
  SignInButton,
  SignUpButton,
} from "@/landing/(auth)/components/buttons";
import { cn } from "@/lib/utils";
import { LandingRoute } from "@/types/routes";

interface AuthButtonsProps {
  containerClassName?: string | undefined;
}

export default function AuthButtons({ containerClassName }: AuthButtonsProps) {
  const pathname = usePathname();

  if (pathname.startsWith(LandingRoute.SignIn)) return <SignUpButton />;

  if (pathname.startsWith(LandingRoute.SignUp)) return <SignInButton />;

  return (
    <div className={cn("flex items-center gap-4", containerClassName)}>
      <SignInButton variant="outline" />
      <SignUpButton />
    </div>
  );
}
