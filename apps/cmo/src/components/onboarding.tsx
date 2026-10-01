interface OnboardingProps {
  name: string;
  onboard: (formData: FormData) => Promise<void>;
}

/** First visit: the business and its goals. Cuso takes it from there. */
export function Onboarding({ name, onboard }: OnboardingProps) {
  return (
    <main>
      <h1>Meet Cuso</h1>
      <p>
        Hi {name}. Cuso is your CMO. Tell him where your business lives and what
        you want from marketing, and he learns the rest.
      </p>
      <form action={onboard} className="stack">
        <label className="field">
          <span>Website</span>
          <input
            name="websiteUrl"
            type="url"
            required
            placeholder="https://yourbusiness.com"
          />
        </label>
        <label className="field">
          <span>Business name</span>
          <input name="businessName" placeholder="Optional" />
        </label>
        <label className="field">
          <span>Marketing goals</span>
          <textarea
            name="goals"
            required
            minLength={3}
            rows={4}
            placeholder="More demo requests from mid size companies, a steady LinkedIn presence"
          />
        </label>
        <button type="submit">Start</button>
      </form>
    </main>
  );
}
