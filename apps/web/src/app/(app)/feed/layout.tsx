import { FeedDataProvider } from "@/app/feed/components/feed-data-provider";
import { feedService } from "@/lib/services";

interface FeedLayoutProps {
  children: React.ReactNode;
}

export default async function FeedLayout({ children }: FeedLayoutProps) {
  const initialPool = await feedService.getMyFeedInitialPool({
    limitPerSource: 20,
  });

  return (
    <FeedDataProvider
      items={initialPool.items}
      jobsCursor={initialPool.jobsCursor}
      tasksCursor={initialPool.tasksCursor}
      hasMore={initialPool.hasMore}
    >
      {children}
    </FeedDataProvider>
  );
}
