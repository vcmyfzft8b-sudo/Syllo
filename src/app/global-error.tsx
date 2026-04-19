"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="sl">
      <body>
        <main style={{ margin: "0 auto", maxWidth: 560, padding: 24 }}>
          <h1>Nekaj je slo narobe.</h1>
          <p>Napako smo zabelezili. Poskusi ponovno ali se vrni cez nekaj minut.</p>
          <button type="button" onClick={reset}>
            Poskusi znova
          </button>
        </main>
      </body>
    </html>
  );
}
