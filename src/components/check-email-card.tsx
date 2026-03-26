"use client";

import { useEffect, useMemo, useState } from "react";

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

  return (
    <>
      <form action="/auth/email/verify" method="post" className="auth-email-form auth-code-form">
        <input type="hidden" name="email" value={props.email} />
        <input type="hidden" name="mode" value={props.mode} />
        <input type="hidden" name="next" value={props.next} />

        <label className="auth-field auth-code-field">
          <input
            type="text"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            minLength={6}
            maxLength={8}
            autoComplete="one-time-code"
            placeholder="Enter code"
            className="auth-code-input"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
            }}
            required
          />
        </label>

        <button type="submit" className="ios-primary-button auth-submit-button">
          Continue
        </button>
      </form>

      <p className={`auth-status-note ${props.messageType === "error" ? "error" : ""}`}>
        {props.message ??
          "The code expires automatically. If you didn’t get it, you can request a new one after the timer ends."}
      </p>

      <div className="auth-check-actions">
        <form action="/auth/email" method="post" className="auth-resend-form">
          <input type="hidden" name="email" value={props.email} />
          <input type="hidden" name="mode" value={props.mode} />
          <input type="hidden" name="next" value={props.next} />
          <button
            type="submit"
            className="auth-secondary-link auth-provider-button-submit auth-tertiary-button"
            disabled={secondsLeft > 0}
            aria-disabled={secondsLeft > 0}
          >
            {secondsLeft > 0 ? `Send new code in ${formatCountdown(secondsLeft)}` : "Send new code"}
          </button>
        </form>
        <a href="/" className="auth-secondary-link auth-tertiary-button">
          Use another method
        </a>
      </div>
    </>
  );
}
