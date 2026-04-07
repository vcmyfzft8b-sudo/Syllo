"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

type EmailAuthFormProps = {
  buttonClassName: string;
  defaultEmail?: string;
  formClassName?: string;
  helperText?: string;
  inputClassName?: string;
  inputWrapperClassName?: string;
  mode: "login" | "signup";
  next: string;
  placeholder: string;
  pendingLabel: string;
  readOnlyWhileSubmitting?: boolean;
  submitLabel: string;
};

export function EmailAuthForm(props: EmailAuthFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bypassSubmitRef = useRef(false);

  return (
    <form
      action="/auth/email"
      method="post"
      className={props.formClassName}
      onSubmit={(event) => {
        if (bypassSubmitRef.current) {
          bypassSubmitRef.current = false;
          return;
        }

        if (isSubmitting) {
          event.preventDefault();
          return;
        }

        const form = event.currentTarget;

        if (!form.reportValidity()) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        setIsSubmitting(true);

        requestAnimationFrame(() => {
          bypassSubmitRef.current = true;
          form.requestSubmit();
        });
      }}
    >
      <input type="hidden" name="mode" value={props.mode} />
      <input type="hidden" name="next" value={props.next} />

      <label className={props.inputWrapperClassName}>
        <input
          type="email"
          name="email"
          required
          defaultValue={props.defaultEmail}
          placeholder={props.placeholder}
          autoComplete="email"
          className={props.inputClassName}
          aria-disabled={isSubmitting}
          readOnly={props.readOnlyWhileSubmitting && isSubmitting}
        />
      </label>

      <button
        type="submit"
        className={props.buttonClassName}
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
        <span>{isSubmitting ? props.pendingLabel : props.submitLabel}</span>
      </button>

      {props.helperText ? <p className="auth-helper-copy">{props.helperText}</p> : null}
    </form>
  );
}
