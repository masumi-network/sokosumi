import { act, render, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import type { JobInputsFormSchemaType } from "@/lib/job-input/form";
import { useJobInputsFormValuesWatch } from "./use-job-inputs-form-values-watch";

describe("useJobInputsFormValuesWatch", () => {
  it("subscribes to form value updates, skips when omitted, and unsubscribes on unmount", () => {
    const onValuesChange = vi.fn();
    let capturedForm!: UseFormReturn<JobInputsFormSchemaType>;

    const { rerender, unmount } = renderHook(
      ({
        handler,
      }: {
        handler: ((values: JobInputsFormSchemaType) => void) | undefined;
      }) => {
        const form = useForm<JobInputsFormSchemaType>({
          defaultValues: { prompt: "" },
        });
        capturedForm = form;
        useJobInputsFormValuesWatch(form, handler);
      },
      {
        initialProps: {
          handler: undefined as typeof onValuesChange | undefined,
        },
      },
    );

    act(() => {
      capturedForm.setValue("prompt", "ignored");
    });
    expect(onValuesChange).not.toHaveBeenCalled();

    rerender({ handler: onValuesChange });
    act(() => {
      capturedForm.setValue("prompt", "hello");
    });
    expect(onValuesChange).toHaveBeenCalledTimes(1);
    expect(onValuesChange).toHaveBeenLastCalledWith({ prompt: "hello" });

    unmount();
    act(() => {
      capturedForm.setValue("prompt", "after-unmount");
    });
    expect(onValuesChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the setup-bound callback between commit and passive cleanup", () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    let capturedForm!: UseFormReturn<JobInputsFormSchemaType>;

    function Probe({
      handler,
      triggerInLayout,
    }: {
      handler: (values: JobInputsFormSchemaType) => void;
      triggerInLayout: boolean;
    }) {
      const form = useForm<JobInputsFormSchemaType>({
        defaultValues: { prompt: "" },
      });
      capturedForm = form;
      useJobInputsFormValuesWatch(form, handler);
      useLayoutEffect(() => {
        if (triggerInLayout) {
          form.setValue("prompt", "between-commit-and-cleanup");
        }
      }, [form, triggerInLayout]);
      return null;
    }

    const { rerender } = render(
      <Probe handler={firstHandler} triggerInLayout={false} />,
    );

    // Rerender with a new handler and emit a form update in a layout effect
    // (after commit, before passive cleanup swaps the subscription).
    rerender(<Probe handler={secondHandler} triggerInLayout />);

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(firstHandler).toHaveBeenLastCalledWith({
      prompt: "between-commit-and-cleanup",
    });
    expect(secondHandler).not.toHaveBeenCalled();

    // After passive cleanup + re-subscribe, subsequent updates invoke the new handler.
    act(() => {
      capturedForm.setValue("prompt", "after-passive-resubscribe");
    });
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenLastCalledWith({
      prompt: "after-passive-resubscribe",
    });
  });
});
