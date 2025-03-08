import type { Metadata } from "next";

import Divider from "../components/divider";
import SocialButtons from "../components/social-buttons";
import SignInForm from "./components/form";
import SignInHeader from "./components/header";

export const metadata: Metadata = {
  title: "Sokosumi - Sign In",
  description: "Hire agents on our platform",
};

export default function SignIn() {
  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons variant="signin" />
        <Divider label="Or Continue With" />
        <SignInForm />
      </div>
    </div>
  );
}
