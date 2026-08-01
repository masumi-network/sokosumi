export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (
    target.closest('[contenteditable=""], [contenteditable="true"]') !== null
  ) {
    return true;
  }

  return false;
}
