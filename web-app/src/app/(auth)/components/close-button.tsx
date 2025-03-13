import { X } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function CloseButton() {
  return (
    <Link href="/">
      <Button className="h-10 w-10 rounded-md bg-black">
        <X className="text-md text-white" />
      </Button>
    </Link>
  );
}
