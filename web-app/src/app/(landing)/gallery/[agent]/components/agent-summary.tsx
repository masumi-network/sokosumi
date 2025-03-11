import Image from "next/image";

import { Button } from "@/components/ui/button";

interface AgentSummaryProps {
  title: string;
  description: string;
  image: string;
  price: number;
}

export default function AgentSummary({
  title,
  description,
  image,
  price,
}: AgentSummaryProps) {
  return (
    <div className="flex h-48 w-full overflow-hidden">
      <div className="relative h-full w-48">
        <Image
          src={image}
          alt={title}
          fill
          className="rounded-md object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col justify-between p-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-muted-foreground line-clamp-1">{description}</p>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex items-end gap-3">
            <Button variant="default" size="lg">
              Hire
            </Button>
            <Button variant="outline" size="lg">
              Share
            </Button>
            <div>
              <p className="text-lg font-semibold">{price} credits</p>
              <p className="text-muted-foreground text-sm">amount may vary</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
