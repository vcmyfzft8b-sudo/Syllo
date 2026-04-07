"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function CheckEmailCard(props: {
  email: string;
  message?: string;
  messageType: "error" | "info";
  mode: "login" | "signup";
  next: string;
  sentAt: number;
  cooldownSeconds: number;
}) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pendingAction, setPendingAction] = useState<"verify" | "resend" | null>(null);
  const bypassSubmitRef = useRef(false);

  const resendAvailableAt = useMemo(
    () => props.sentAt + props.cooldownSeconds * 1000,
    [props.cooldownSeconds, props.sentAt],
  );

  useEffect(() => {
    function updateCountdown() {
      const remaining = Math.max(
        0,
        Math.ceil((resendAvailableAt - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    }

    updateCountdown();

    const intervalId = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(intervalId);
  }, [resendAvailableAt]);

  function lockAndSubmit(
    event: React.FormEvent<HTMLFormElement>,
    action: "verify" | "resend",
  ) {
    if (bypassSubmitRef.current) {
      bypassSubmitRef.current = false;
      return;
    }

    if (pendingAction !== null) {
      event.preventDefault();
      return;
    }

    const form = event.currentTarget;

    if (!form.reportValidity()) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setPendingAction(action);

    requestAnimationFrame(() => {
      bypassSubmitRef.current = true;
      form.requestSubmit();
    });
  }

  return (
    <div className="check-email-card">
      <form
        action="/auth/email/verify"
        method="post"
        className="auth-email-form auth-code-form check-email-form"
        onSubmit={(event) => {
          lockAndSubmit(event, "verify");
        }}
      >
        <input type="hidden" name="email" value={props.email} />
        <input type="hidden" name="mode" value={props.mode} />
        <input type="hidden" name="next" value={props.next} />

        <label className="auth-field auth-code-field check-email-code-field">
          <input
            type="text"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            minLength={6}
            maxLength={8}
            autoComplete="one-time-code"
            placeholder="Vnesi kodo"
            className="auth-code-input check-email-code-input"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
            }}
            aria-disabled={pendingAction !== null}
            required
            readOnly={pendingAction !== null}
          />
        </label>

        <button
          type="submit"
          className="ios-primary-button auth-submit-button check-email-submit"
          disabled={pendingAction !== null}
          aria-busy={pendingAction === "verify"}
        >
          {pendingAction === "verify" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          <span>{pendingAction === "verify" ? "Preverjam..." : "Nadaljuj"}</span>
        </button>
      </form>

      <p className={`auth-status-note check-email-status-note ${props.messageType === "error" ? "error" : ""}`}>
        {props.message ??
          "Koda samodejno poteče. Če je nisi prejel, lahko po izteku časovnika zahtevaš novo."}
      </p>

      <div className="auth-check-actions check-email-actions">
        <form
          action="/auth/email"
          method="post"
          className="auth-resend-form"
          onSubmit={(event) => {
            lockAndSubmit(event, "resend");
          }}
        >
          <input type="hidden" name="email" value={props.email} />
          <input type="hidden" name="mode" value={props.mode} />
          <input type="hidden" name="next" value={props.next} />
          <button
            type="submit"
            className="auth-secondary-link auth-provider-button-submit auth-tertiary-button check-email-secondary"
            disabled={secondsLeft > 0 || pendingAction !== null}
            aria-disabled={secondsLeft > 0 || pendingAction !== null}
            aria-busy={pendingAction === "resend"}
          >
            {pendingAction === "resend"
              ? "Pošiljam..."
              : secondsLeft > 0
                ? `Novo kodo pošlji čez ${formatCountdown(secondsLeft)}`
                : "Pošlji novo kodo"}
          </button>
        </form>
        <Link href="/" className="auth-secondary-link auth-tertiary-button check-email-secondary">
          Uporabi drugo metodo
        </Link>
      </div>
    </div>
  );
}
