// These exact names describe completions. Generic clicks, form starts and leads are ambiguous.
const completionNames = new Map([
  ["book", "appointment_booked"],
  ["call", "phone_call_completed"],
  ["contact sales", "sales_contact_submitted"],
  ["subscribe", "subscription_confirmed"],
]);
export function allowsSeoCompletionEvent(action?: string | null) {
  return !!action && completionNames.has(action);
}

export function seoCompletionEvent(goal?: {
  action: string | null;
  completionEvent?: string;
}) {
  if (goal?.action === "buy") return "purchase";
  if (goal?.action === "sign up") return "sign_up";
  return allowsSeoCompletionEvent(goal?.action)
    ? (goal?.completionEvent ?? completionNames.get(goal!.action!))
    : undefined;
}
