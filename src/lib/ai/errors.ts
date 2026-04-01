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
