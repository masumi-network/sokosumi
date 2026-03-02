import { FeedList } from "@/app/feed/components/feed-list";

export const metadata = {
  title: "My Feed",
};

export default function FeedPage() {
  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <FeedList />
    </div>
  );
}
