import {
  type InputHTMLAttributes,
  type RefObject,
  useEffect,
  useRef,
} from "react";

interface FormFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "aria-describedby" | "aria-invalid" | "id" | "name"
  > {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
}

/**
 * A labelled input with its hint and error. Assistive tech reads both with
 * the input, and an error marks it invalid.
 */
export function FormField({
  id,
  name,
  label,
  hint,
  error,
  ...inputProps
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        {...inputProps}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hintId, errorId].filter(Boolean).join(" ") || undefined
        }
      />
      {hint ? (
        <p id={hintId} className="note">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * For a `useActionState` form that remounts with `key={attempt}`, because a
 * form resets after its action: remounting shows the kept values and reads
 * out a repeated alert again. After a failed submit, focus moves to the
 * first field to fix, which reads out its error; the remount would otherwise
 * drop focus to the page.
 */
export function useFocusFirstInvalid(
  attempt: number,
): RefObject<HTMLFormElement | null> {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (attempt === 0) return;
    formRef.current
      ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
      ?.focus();
  }, [attempt]);
  return formRef;
}
