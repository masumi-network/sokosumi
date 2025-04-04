import { Loader2 } from "lucide-react";

export default function JobLoading({ right }: { right: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col p-4 xl:p-8">
      <div className="mt-6 flex flex-1 justify-center py-12">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        {right}
      </div>
    </div>
  );
}
