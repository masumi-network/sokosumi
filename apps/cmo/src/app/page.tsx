import { headers } from "next/headers";

import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { getAuth } from "../lib/auth";
import { createAccount, signIn, signOut } from "./actions";

interface HomePageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) {
    return (
      <SignedIn
        name={session.user.name}
        email={session.user.email}
        signOut={signOut}
      />
    );
  }

  const { error } = await searchParams;
  return (
    <SignedOut
      error={typeof error === "string" ? error : undefined}
      createAccount={createAccount}
      signIn={signIn}
    />
  );
}
