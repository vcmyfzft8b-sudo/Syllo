"use client";

import { useRouter } from "next/navigation";

export class BillingRequiredError extends Error {
  redirectTo: string;

  constructor(message: string, redirectTo: string) {
    super(message);
    this.name = "BillingRequiredError";
    this.redirectTo = redirectTo;
  }
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
  const clonedResponse = response.clone();
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; redirectTo?: string; code?: string })
    | null;

  if (!response.ok) {
    if (response.status === 402 && payload?.redirectTo) {
      throw new BillingRequiredError(
        payload.error ?? "Za to dejanje je potreben plačljiv paket.",
        payload.redirectTo,
      );
    }

    const fallbackText = await clonedResponse.text().catch(() => "");
    throw new Error(
      payload?.error ??
        (fallbackText.trim().length > 0 ? fallbackText.trim().slice(0, 240) : null) ??
        "Zahteve ni bilo mogoče dokončati.",
    );
  }

  return (payload ?? {}) as T;
}

export function redirectToBillingIfNeeded(params: {
  error: unknown;
  router: ReturnType<typeof useRouter>;
}) {
  if (params.error instanceof BillingRequiredError) {
    params.router.push(params.error.redirectTo);
    return true;
  }

  return false;
}
