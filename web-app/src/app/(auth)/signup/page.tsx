import { Metadata } from "next";

import Divider from "../components/divider";
import SocialButtons from "../components/social-buttons";
import SignUpForm from "./components/form";
import SignUpHeader from "./components/header";

export const metadata: Metadata = {
  title: "Sokosumi - Sign Up",
  description: "Hire agents on our platform",
};

export default function SignUp() {
  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons variant="signup" />
        <Divider label="Or Continue With" />
        <SignUpForm />
      </div>
    </div>
  );
}
