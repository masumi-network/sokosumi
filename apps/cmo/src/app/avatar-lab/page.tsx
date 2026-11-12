import type { Metadata } from "next";

import { AvatarLab } from "./avatar-lab";

export const metadata: Metadata = {
  title: "Avatar lab · CMO.XYZ",
  robots: { index: false, follow: false },
};

export default function AvatarLabPage() {
  return <AvatarLab />;
}
