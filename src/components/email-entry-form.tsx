"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

export function EmailEntryForm({
  email,
  mode,
  next,
}: {
  email: string;
  mode: "login" | "signup";
  next: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form
      action="/auth/email"
      method="post"
      className="email-entry-form"
      onSubmit={(event) => {
        if (isSubmitting) {
          event.preventDefault();
          return;
        }

        const form = event.currentTarget;

        if (!form.reportValidity()) {
          event.preventDefault();
          return;
        }

        setIsSubmitting(true);
      }}
    >
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next} />
      <input
        type="email"
        name="email"
        required
        defaultValue={email}
        placeholder="Vnesi e-naslov"
        autoComplete="email"
        className="email-entry-input"
        aria-disabled={isSubmitting}
        readOnly={isSubmitting}
      />
      <button
        type="submit"
        className="email-entry-submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
        <span>{isSubmitting ? "Pošiljam kodo..." : "Nadaljuj"}</span>
      </button>
    </form>
  );
}
