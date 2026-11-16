/**
 * One line for Resend.
 *
 * Subjects are catalog text plus names a person typed: a task, a room, a
 * person. Those names can contain a line break, and Resend rejects the send
 * when `subject` does. Collapse every whitespace run, then trim, so the
 * string that leaves a renderer is one line.
 */
export function toSingleLineSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim();
}
