function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isRetryableAiError(error: unknown) {
  const message = getErrorText(error).toLowerCase();

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return false;
  }

  return (
    message.includes("503") ||
    message.includes("429") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("try again later") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("deadline exceeded") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

export function toUserFacingAiErrorMessage(error: unknown) {
  const message = getErrorText(error).toLowerCase();

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return "The note took too long to save. Please retry this note in a minute.";
  }

  if (isRetryableAiError(error)) {
    return "The AI provider is temporarily overloaded. Please retry this note in a minute.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown processing error.";
}
