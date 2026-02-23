/**
 * Bucket layout - renders children only.
 * All sidebar/bucket logic is handled by ChatLayoutClient in the parent layout.
 */
export default function ChatBucketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
