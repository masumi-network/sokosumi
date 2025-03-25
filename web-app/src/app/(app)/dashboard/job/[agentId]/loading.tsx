import { HeaderSkeleton } from "./components/header";

export default function JobLoading() {
  return (
    <div className="flex flex-1 flex-col p-4 xl:p-8">
      <HeaderSkeleton />
    </div>
  );
}
