import { EmailAuthForm } from "@/components/email-auth-form";

export function EmailEntryForm({
  email,
  mode,
  next,
}: {
  email: string;
  mode: "login" | "signup";
  next: string;
}) {
  return (
    <EmailAuthForm
      buttonClassName="email-entry-submit"
      defaultEmail={email}
      formClassName="email-entry-form"
      inputClassName="email-entry-input"
      mode={mode}
      next={next}
      placeholder="Vnesi e-naslov"
      pendingLabel="Pošiljam kodo..."
      readOnlyWhileSubmitting
      submitLabel="Nadaljuj"
    />
  );
}
