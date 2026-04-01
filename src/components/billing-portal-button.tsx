"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";

export function BillingPortalButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);

    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Portala za obračun ni bilo mogoče odpreti.");
      }

      window.location.href = payload.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="settings-inline-action" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <EmojiIcon symbol="💳" size="0.95rem" />}
      Uredi naročnino
    </button>
  );
}
