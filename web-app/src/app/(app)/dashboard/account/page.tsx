import { AccountSettingsForm } from "./components/account-settings-form";

export default function Page() {
  return (
    <div className="flex items-center justify-center gap-16 p-8 sm:p-20">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Account Settings
          </h1>
          <p className="text-muted-foreground text-sm">
            Update your email address and password
          </p>
        </div>
        <AccountSettingsForm />
      </div>
    </div>
  );
}
