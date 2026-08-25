import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Markdown from "@/components/markdown";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children?: ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href={href} className={className} data-next-link="true" {...props}>
      {children}
    </a>
  ),
}));

describe("Markdown links", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses Next.js Link for in-app paths so navigation stays client-side", () => {
    const { container } = render(
      <Markdown>{"see [#general](/chat/rooms/room-1)"}</Markdown>,
    );

    const link = container.querySelector("a[href='/chat/rooms/room-1']");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("data-next-link", "true");
    expect(link).not.toHaveAttribute("target");
  });

  it("keeps markdown link titles on in-app Next.js Links", () => {
    const { container } = render(
      <Markdown>{'see [general](/chat/rooms/room-1 "Launch")'}</Markdown>,
    );

    const link = container.querySelector("a[href='/chat/rooms/room-1']");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("data-next-link", "true");
    expect(link).toHaveAttribute("title", "Launch");
  });

  it("opens external links in a new tab", () => {
    const { container } = render(
      <Markdown>{"see [docs](https://example.com/path)"}</Markdown>,
    );

    const link = container.querySelector("a[href='https://example.com/path']");
    expect(link).not.toBeNull();
    expect(link).not.toHaveAttribute("data-next-link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
