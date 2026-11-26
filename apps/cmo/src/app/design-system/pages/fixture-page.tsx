"use client";

import { NameSetup } from "../../../components/name-setup";
import { SignInProblem } from "../../../components/sign-in-problem";
import { SignedIn } from "../../../components/signed-in";
import ErrorPage from "../../error";
import type { FixturePageName } from "./fixtures";

const nothing = async () => {};

export function FixturePage({ page }: { page: FixturePageName }) {
  switch (page) {
    case "signed-in":
    case "invite-only":
      return (
        <SignedIn
          name="Francis Luz"
          email="francis@acme.io"
          signOut={nothing}
          inviteOnly={page === "invite-only"}
        />
      );
    case "sign-in-problem":
      return <SignInProblem error="state_mismatch" signIn={nothing} />;
    case "name-setup":
      return (
        <NameSetup saveName={async (previous) => previous} signOut={nothing} />
      );
    case "error":
      return <ErrorPage error={new Error("preview")} retry={() => {}} />;
  }
}
