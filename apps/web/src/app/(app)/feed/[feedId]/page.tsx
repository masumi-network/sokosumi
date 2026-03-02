import { FeedDetail } from "@/app/feed/components/feed-detail";
import { feedService } from "@/lib/services";

interface FeedDetailPageProps {
  params: Promise<{ feedId: string }>;
}

export default async function FeedDetailPage({ params }: FeedDetailPageProps) {
  const { feedId } = await params;
  const item = await feedService.getMyFeedItemByFeedId(feedId);

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <FeedDetail feedId={feedId} item={item} />
    </div>
  );
}
