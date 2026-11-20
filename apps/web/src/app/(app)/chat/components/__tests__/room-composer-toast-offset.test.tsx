import { act, render } from "@testing-library/react";
import { Activity, type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomComposer } from "../room-composer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/chat/composer-wysiwyg-editor", () => ({
  ComposerWysiwygEditor: ({ ref }: { ref?: Ref<{ focus: () => void }> }) => {
    useImperativeHandle(ref, () => ({ focus: () => undefined }));
    return <div role="textbox" />;
  },
}));

vi.mock("@/components/chat/room-message-composer", () => ({
  ROOM_COMPOSER_TEXTAREA_CLASSNAME: "",
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME: "",
  RoomComposerEmojiPicker: () => null,
  RoomMessageComposer: ({
    formRef,
    children,
  }: {
    formRef?: Ref<HTMLFormElement | null>;
    children?: ReactNode;
  }) => <form ref={formRef}>{children}</form>,
}));

vi.mock("@/components/chat/composer-format-toolbar", () => ({
  ComposerFormatToolbar: () => null,
}));

vi.mock("@/components/chat/composer-add-link-dialog", () => ({
  ComposerAddLinkDialog: () => null,
}));

vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: () => null,
}));

vi.mock("@/components/drive/attachment-submenu", () => ({
  AttachmentSubmenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("RoomComposer --toast-bottom-offset lifecycle", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--toast-bottom-offset");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("tracks form resize, window resize, visualViewport resize, Activity hide/resume, and unmount", () => {
    let formTop = 700;
    let triggerResize: (() => void) | null = null;
    const disconnect = vi.fn();

    vi.stubGlobal("innerHeight", 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return {
          top: this.tagName === "FORM" ? formTop : 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );

    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(private callback: ResizeObserverCallback) {}
        observe() {
          triggerResize = () => this.callback([], this);
        }
        unobserve() {}
        disconnect = disconnect;
      },
    );

    const visualViewport = new EventTarget();
    vi.stubGlobal("visualViewport", visualViewport);

    const composer = (
      <RoomComposer
        value=""
        onValueChange={vi.fn()}
        mentions={{}}
        placeholder="Message"
        attachments={[]}
        onAttachmentsChange={vi.fn()}
        onSubmit={vi.fn()}
        isSending={false}
        sendDisabled={false}
      />
    );

    const { rerender, unmount } = render(
      <Activity mode="visible">{composer}</Activity>,
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("208px");

    formTop = 650;
    act(() => triggerResize?.());
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("258px");

    vi.stubGlobal("innerHeight", 800);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("158px");

    formTop = 500;
    act(() => {
      visualViewport.dispatchEvent(new Event("resize"));
    });
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("308px");

    // Activity hide removes the offset and disconnects the observer.
    rerender(<Activity mode="hidden">{composer}</Activity>);
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");
    expect(disconnect).toHaveBeenCalled();

    // Activity resume re-measures and restores the offset.
    formTop = 520;
    rerender(<Activity mode="visible">{composer}</Activity>);
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("288px");

    unmount();
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");
  });
});
