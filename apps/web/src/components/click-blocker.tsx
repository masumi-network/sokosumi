"use client";

interface ClickBlockerProps {
  className?: string | undefined;
  children: React.ReactNode;
}

export default function ClickBlocker({
  className,
  children,
}: ClickBlockerProps) {
  return (
    <div
      className={className}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
