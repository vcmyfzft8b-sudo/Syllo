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
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; redirectTo?: string; code?: string })
    | null;

  if (!response.ok) {
    if (response.status === 402 && payload?.redirectTo) {
      throw new BillingRequiredError(
        payload.error ?? "A paid plan is required for this action.",
        payload.redirectTo,
      );
    }

    throw new Error(payload?.error ?? "The request could not be completed.");
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
