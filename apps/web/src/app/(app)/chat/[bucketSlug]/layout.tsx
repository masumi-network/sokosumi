export default function ChatBucketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ bucketSlug: string }>();
  const bucketSlug = params?.bucketSlug;
  const { conversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();

  const bucket = useMemo(() => {
    if (!bucketSlug) return null;
    const fromConversations = bucketKeyFromDisplaySlug(
      conversations,
      bucketSlug,
    );
    if (fromConversations) return fromConversations;
    const slugLower = bucketSlug.trim().toLowerCase();
    const coworker = coworkers?.find(
      (c) =>
        (c.slug && slugify(c.slug) === slugLower) ||
        (c.name && slugify(c.name) === slugLower),
    );
    if (coworker) return `coworker:${coworker.id}`;
    return slugToBucketKey(bucketSlug) || null;
  }, [bucketSlug, conversations, coworkers]);

  const bucketData = useMemo(() => {
    if (!bucket) return null;
    const list = conversations.filter((c) => {
      const meta = (c.metadata as ConversationMetadata | null) ?? null;
      return getGroupKey(meta) === bucket;
    });
    const meta =
      list.length > 0
        ? ((list[0].metadata as ConversationMetadata | null) ?? null)
        : null;
    const displayName =
      meta?.model_name ?? meta?.coworker_name ?? bucket ?? "Chat";
    return { displayName, conversations: list };
  }, [bucket, conversations]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="-mt-20 -mb-4 flex min-h-[calc(100svh-64px)] w-full flex-col gap-4 md:-mt-4 lg:flex-row lg:items-stretch">
        <div className="w-full px-4 lg:sticky lg:top-16 lg:h-[calc(100svh-64px)] lg:w-72 lg:flex-none">
          <ChatConversationsSidebar
            bucketSlug={bucketSlug ?? ""}
            bucket={bucket ?? ""}
            displayName={bucketData?.displayName ?? bucketSlug ?? "Chat"}
            conversations={bucketData?.conversations ?? []}
          />
        </div>
        <div className="h-full min-h-0 min-w-0 flex-1 pt-20 pb-4 md:pt-4">
          <div className="mx-auto h-full min-h-0 w-full px-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
