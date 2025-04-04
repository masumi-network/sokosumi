import { Loader2 } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

export default function DefaultLoading() {
  return (
    <div className={"flex h-full min-h-[300px] flex-1 flex-col"}>
      <ScrollArea className="h-[calc(100%)] overflow-y-scroll rounded-md border p-4 px-8">
        <div className="mt-6 flex flex-1 justify-center py-12">
          <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        </div>
      </ScrollArea>
    </div>
  );
}
