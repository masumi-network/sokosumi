import { AuthHeader } from "@/auth/components/auth-header";
import { AuthPage } from "@/auth/components/auth-page";
import { Skeleton } from "@/components/ui/skeleton";

import SignInRow from "./components/sign-in-link";

export default function RegisterLoadingPage() {
  return (
    <AuthPage header={<AuthHeader mode="signUp" />}>
      {/* First step: the email field and its button, then two providers. */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[50px] w-full" />
        <Skeleton className="h-[50px] w-full" />
      </div>
      <SignInRow />
    </AuthPage>
  );
}
