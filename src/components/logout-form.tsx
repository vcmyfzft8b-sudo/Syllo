"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";

export function LogoutForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form
      action="/auth/logout"
      method="post"
      onSubmit={(event) => {
        if (isSubmitting) {
          event.preventDefault();
          return;
        }

        setIsSubmitting(true);
      }}
    >
      <button
        type="submit"
        className="settings-inline-action"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <EmojiIcon symbol="🚪" size="0.95rem" />
        )}
        {isSubmitting ? "Odjavljam..." : "Odjava"}
      </button>
    </form>
  );
}
