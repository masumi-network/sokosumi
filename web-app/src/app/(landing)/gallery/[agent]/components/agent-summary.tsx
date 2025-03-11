import Image from "next/image";

import { Button } from "@/components/ui/button";

interface AgentSummaryProps {
  title: string;
  author: string;
  image: string;
  price: number;
}

export default function AgentSummary({
  title,
  author,
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
      <div className="flex flex-1 flex-col px-6 py-2">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-muted-foreground line-clamp-1">by {author}</p>
          <p className="pt-1 text-sm font-medium">{price} credits</p>
        </div>
        <div className="mt-auto flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button variant="default" size="lg">
              Hire
            </Button>
            <Button variant="outline" size="lg">
              Share
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
