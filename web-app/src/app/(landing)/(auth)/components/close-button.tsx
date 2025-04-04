import { X } from "lucide-react";

import TypedLink from "@/components/typed-link";
import { Button } from "@/components/ui/button";

export default function CloseButton() {
  return (
    <TypedLink route={{ pathname: "/" }}>
      <Button className="h-10 w-10 rounded-md bg-black">
        <X className="text-md text-white" />
      </Button>
    </TypedLink>
  );
}
