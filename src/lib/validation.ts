import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const routeIdParamSchema = z.object({
  id: uuidSchema,
});

export const optionalLectureIdSchema = uuidSchema.optional();

export const languageHintSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/, {
    message: "Use a valid short language code such as sl or en.",
  });

export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an http or https URL.");

export const optionalUploadFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\0\r\n]/.test(value), {
    message: "File name contains unsupported characters.",
  })
  .optional();

export const optionalDocumentLectureIdSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (typeof value === "string" ? value.trim() : null))
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .pipe(optionalLectureIdSchema);

export const optionalOriginalFileNameSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (typeof value === "string" ? value.trim() : ""))
  .refine((value) => value.length === 0 || !/[\0\r\n]/.test(value), {
    message: "File name contains unsupported characters.",
  })
  .refine((value) => value.length <= 255, {
    message: "File name must be 255 characters or fewer.",
  });
