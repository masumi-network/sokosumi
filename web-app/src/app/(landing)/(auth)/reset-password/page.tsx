import ResetPasswordForm from "./components/form";
import ResetPasswordHeader from "./components/header";

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ResetPasswordHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <ResetPasswordForm />
      </div>
    </div>
  );
}
