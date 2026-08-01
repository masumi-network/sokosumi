/**
 * Whether a keyboard event target is a text-editing surface.
 * Global shortcuts should skip these so editor bindings (e.g. Cmd+B bold) win.
 */
export function isEditableKeyboardTarget(_target: EventTarget | null): boolean {
  // Stub: failing repro before the editable-target guard lands.
  return false;
}
