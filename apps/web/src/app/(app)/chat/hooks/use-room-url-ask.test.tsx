import { render } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

import {
  type EditChannelParamParams,
  useEditChannelParam,
} from "./use-edit-channel-param";

function Harness(props: EditChannelParamParams) {
  useEditChannelParam(props);
  return null;
}

function searchParams(search: string): ReadonlyURLSearchParams {
  return new URLSearchParams(search) as unknown as ReadonlyURLSearchParams;
}

function makeProps(
  overrides: Partial<EditChannelParamParams> = {},
): EditChannelParamParams {
  return {
    roomId: "room-1",
    ready: true,
    pathname: "/chat/rooms/room-1",
    searchParams: searchParams("edit=1"),
    replace: vi.fn(),
    open: vi.fn(),
    ...overrides,
  };
}

describe("useEditChannelParam", () => {
  it("opens the dialog the URL asks for", () => {
    const props = makeProps();
    render(<Harness {...props} />);

    expect(props.open).toHaveBeenCalledTimes(1);
  });

  it("takes its own parameter back off the URL", () => {
    const props = makeProps({
      searchParams: searchParams("edit=1&notice=welcome"),
    });
    render(<Harness {...props} />);

    expect(props.replace).toHaveBeenCalledExactlyOnceWith(
      "/chat/rooms/room-1?notice=welcome",
      { scroll: false },
    );
  });

  // Both readers rebuild the URL from the same snapshot, so two writes in one
  // commit would each put the other parameter back, for good.
  it("waits for a message the room has not jumped to yet", () => {
    const props = makeProps({
      searchParams: searchParams("edit=1&message=msg-1"),
    });
    const { rerender } = render(<Harness {...props} />);

    expect(props.open).not.toHaveBeenCalled();
    expect(props.replace).not.toHaveBeenCalled();

    // The message reader has spent it and written the shorter URL.
    rerender(<Harness {...props} searchParams={searchParams("edit=1")} />);

    expect(props.open).toHaveBeenCalledTimes(1);
    expect(props.replace).toHaveBeenCalledExactlyOnceWith(
      "/chat/rooms/room-1",
      {
        scroll: false,
      },
    );
  });

  // A blank message names nothing, so the message reader never spends it.
  // Waiting for it to go would wait for good.
  it("does not wait for a message that names nothing", () => {
    const props = makeProps({
      searchParams: searchParams("edit=1&message=%20"),
    });
    render(<Harness {...props} />);

    expect(props.open).toHaveBeenCalledTimes(1);
    expect(props.replace).toHaveBeenCalledExactlyOnceWith(
      "/chat/rooms/room-1?message=+",
      { scroll: false },
    );
  });

  it("waits while the URL still names the room the reader is leaving", () => {
    const props = makeProps({ pathname: "/chat/rooms/room-2" });
    const { rerender } = render(<Harness {...props} />);

    expect(props.open).not.toHaveBeenCalled();
    expect(props.replace).not.toHaveBeenCalled();

    rerender(<Harness {...props} pathname="/chat/rooms/room-1" />);

    expect(props.open).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the URL asks for nothing", () => {
    const props = makeProps({ searchParams: searchParams("") });
    render(<Harness {...props} />);

    expect(props.open).not.toHaveBeenCalled();
    expect(props.replace).not.toHaveBeenCalled();
  });

  it("waits for the roster before opening", () => {
    const props = makeProps({ ready: false });
    const { rerender } = render(<Harness {...props} />);

    expect(props.open).not.toHaveBeenCalled();

    rerender(<Harness {...props} ready />);

    expect(props.open).toHaveBeenCalledTimes(1);
  });

  it("opens once while the stripped URL is still landing", () => {
    const props = makeProps();
    const { rerender } = render(<Harness {...props} />);
    // A fresh callback each render, which is the case the guard has to
    // survive whether or not the compiler keeps the identity stable.
    rerender(<Harness {...props} open={() => props.open()} />);

    expect(props.open).toHaveBeenCalledTimes(1);
  });

  it("opens again when the reader asks a second time for the same channel", () => {
    const props = makeProps();
    const { rerender } = render(<Harness {...props} />);
    rerender(<Harness {...props} searchParams={searchParams("")} />);
    rerender(<Harness {...props} />);

    expect(props.open).toHaveBeenCalledTimes(2);
  });
});
