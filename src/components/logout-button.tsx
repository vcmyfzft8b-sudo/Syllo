"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";

export function LogoutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <button
      type="submit"
      className="settings-inline-action"
      disabled={isSubmitting}
      aria-busy={isSubmitting}
      onClick={() => {
        setIsSubmitting(true);
      }}
    >
      {isSubmitting ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <EmojiIcon symbol="🚪" size="0.95rem" />
      )}
      {isSubmitting ? "Odjavljam..." : "Odjava"}
    </button>
  );
}
