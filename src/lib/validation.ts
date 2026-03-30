import { z } from "zod";

export const uuidSchema = z.string().uuid();

const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_REDIRECT_PATH_LENGTH = 2048;

function normalizeUserInput(value: string) {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n");
}

export function sanitizeUserInput(value: string, options?: {
  trim?: boolean;
  collapseWhitespace?: boolean;
}) {
  let nextValue = normalizeUserInput(value);

  if (options?.collapseWhitespace) {
    nextValue = nextValue.replace(/[^\S\n]+/g, " ");
  }

  if (options?.trim ?? true) {
    nextValue = nextValue.trim();
  }

  return nextValue;
}

export function createSanitizedStringSchema(options?: {
  trim?: boolean;
  collapseWhitespace?: boolean;
  minLength?: number;
  maxLength?: number;
  multiline?: boolean;
}) {
  let outputSchema = z.string().refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value), {
    message: "Input contains unsupported control characters.",
  });

  if (!options?.multiline) {
    outputSchema = outputSchema.refine((value) => !value.includes("\n"), {
      message: "Input must be a single line.",
    });
  }

  if (typeof options?.minLength === "number") {
    outputSchema = outputSchema.min(options.minLength);
  }

  if (typeof options?.maxLength === "number") {
    outputSchema = outputSchema.max(options.maxLength);
  }

  return z
    .string()
    .transform((value) =>
      sanitizeUserInput(value, {
        trim: options?.trim,
        collapseWhitespace: options?.collapseWhitespace,
      }),
    )
    .pipe(outputSchema);
}

export function normalizeNextPath(value: string | null | undefined, fallback = "/app/start") {
  if (typeof value !== "string") {
    return fallback;
  }

  const sanitized = sanitizeUserInput(value);

  if (
    sanitized.length === 0 ||
    sanitized.length > MAX_REDIRECT_PATH_LENGTH ||
    !sanitized.startsWith("/") ||
    sanitized.startsWith("//") ||
    DISALLOWED_CONTROL_CHARACTERS.test(sanitized)
  ) {
    return fallback;
  }

  return sanitized;
}

export const routeIdParamSchema = z.object({
  id: uuidSchema,
});

export const optionalLectureIdSchema = uuidSchema.optional();

export const languageHintSchema = createSanitizedStringSchema({
  minLength: 2,
  maxLength: 12,
})
  .transform((value) => value.toLowerCase())
  .pipe(
    z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/, {
      message: "Use a valid short language code such as sl or en.",
    }),
  );

export const httpUrlSchema = createSanitizedStringSchema({
  minLength: 10,
  maxLength: 2048,
}).pipe(
  z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }, "Use an http or https URL."),
);

export const optionalUploadFileNameSchema = z
  .string()
  .transform((value) => sanitizeUserInput(value))
  .pipe(
    z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !/[\0\n]/.test(value), {
        message: "File name contains unsupported characters.",
      }),
  )
  .optional();

export const optionalDocumentLectureIdSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (typeof value === "string" ? sanitizeUserInput(value) : null))
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .pipe(optionalLectureIdSchema);

export const optionalOriginalFileNameSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (typeof value === "string" ? sanitizeUserInput(value) : ""))
  .refine((value) => value.length === 0 || !/[\0\r\n]/.test(value), {
    message: "File name contains unsupported characters.",
  })
  .refine((value) => value.length <= 255, {
    message: "File name must be 255 characters or fewer.",
  });

export const emailAddressSchema = createSanitizedStringSchema({
  minLength: 3,
  maxLength: 320,
}).pipe(z.string().email());

export const nextPathSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => normalizeNextPath(value));

export const lectureTitleSchema = createSanitizedStringSchema({
  minLength: 1,
  maxLength: 180,
  collapseWhitespace: true,
});

export const chatQuestionSchema = createSanitizedStringSchema({
  minLength: 3,
  maxLength: 1000,
  multiline: true,
});

export const noteTextSchema = createSanitizedStringSchema({
  minLength: 120,
  maxLength: 120000,
  multiline: true,
});

export const storagePathSchema = createSanitizedStringSchema({
  minLength: 3,
  maxLength: 512,
});

export const verificationCodeSchema = createSanitizedStringSchema({
  minLength: 6,
  maxLength: 8,
}).pipe(
  z.string().regex(/^\d{6,8}$/, "Enter the verification code from your email."),
);
