import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { toUserFacingAiErrorMessage } from "@/lib/ai/errors";
import { chatAnswerSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { createEmbeddings } from "@/lib/ai/embeddings";
import { parseAudioChunkManifest } from "@/lib/audio-processing";
import { CHAT_MATCH_COUNT } from "@/lib/constants";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import {
  buildSyntheticTranscriptFromTextSource,
  estimateTextSourceDurationSeconds,
  type StructuredSourceBlock,
} from "@/lib/text-source-processing";
import type { ChatMessageWithCitations } from "@/lib/types";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { normalizeMimeType } from "@/lib/storage";
import { serializeVector } from "@/lib/utils";
import { getTranscriptionProvider } from "@/lib/transcription/provider";

const transcriptionProvider = getTranscriptionProvider();
const EMBEDDING_BATCH_SIZE = 100;

type LecturePipelineRow = {
  id: string;
  storage_path: string | null;
  language_hint: string | null;
  duration_seconds: number | null;
  source_type: string | null;
  title: string | null;
  processing_metadata: unknown;
};

function parseProcessingMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

async function updateLectureProcessingState(params: {
  lectureId: string;
  processingMetadata: unknown;
  stage: "transcribing" | "generating_notes" | "ready" | "failed";
  errorMessage?: string | null;
  durationSeconds?: number | null;
  title?: string | null;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const metadata = parseProcessingMetadata(params.processingMetadata);

  await supabase
    .from("lectures")
    .update(
      {
        status: params.stage,
        error_message: params.errorMessage ?? null,
        duration_seconds: params.durationSeconds,
        title: params.title,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: params.stage,
            updatedAt: new Date().toISOString(),
            errorMessage: params.errorMessage ?? null,
          },
        },
      } as never,
    )
    .eq("id", params.lectureId);
}

function toErrorMessage(error: unknown) {
  return toUserFacingAiErrorMessage(error);
}

function assertTranscriptCoverage(params: {
  transcript: {
    text: string;
    segments: Array<{ startMs: number; endMs: number; text: string }>;
    durationSeconds: number;
  };
  expectedDurationSeconds: number | null;
}) {
  const { transcript, expectedDurationSeconds } = params;

  if (transcript.segments.length === 0 || transcript.text.trim().length === 0) {
    throw new Error("Transcript is empty.");
  }

  if (!expectedDurationSeconds || expectedDurationSeconds < 60) {
    return;
  }

  const expectedEndMs = expectedDurationSeconds * 1000;
  const lastSegmentEndMs = transcript.segments.reduce(
    (maxEndMs, segment) => Math.max(maxEndMs, segment.endMs),
    0,
  );
  const allowedGapMs = Math.max(30_000, expectedEndMs * 0.05);

  if (expectedEndMs - lastSegmentEndMs > allowedGapMs) {
    throw new Error(
      `Transcript appears incomplete. Expected about ${expectedDurationSeconds}s but only covered ${Math.round(lastSegmentEndMs / 1000)}s.`,
    );
  }
}

async function getLectureForPipeline(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("*")
    .eq("id", params.lectureId)
    .single();

  if (lectureError) {
    throw lectureError;
  }

  return {
    supabase,
    lecture: lecture as LecturePipelineRow,
  };
}

export async function transcribeLectureContent(params: { lectureId: string }) {
  const { supabase, lecture } = await getLectureForPipeline(params);

  if (!lecture.storage_path) {
    throw new Error("Lecture has no storage path.");
  }

  await supabase
    .from("lectures");
  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "transcribing",
  });

  const audioChunks = parseAudioChunkManifest(
    lecture.processing_metadata && typeof lecture.processing_metadata === "object"
      ? (lecture.processing_metadata as Record<string, unknown>).audioChunks
      : null,
  ).sort((left, right) => left.index - right.index);

  const transcript =
    audioChunks.length > 0 && transcriptionProvider.transcribeChunks
      ? await transcriptionProvider.transcribeChunks({
          chunks: await Promise.all(
            audioChunks.map(async (chunk) => {
              const { data: chunkBlob, error: chunkDownloadError } = await supabase.storage
                .from("lecture-audio")
                .download(chunk.path);

              if (chunkDownloadError) {
                throw chunkDownloadError;
              }

              return {
                file: new File([chunkBlob], chunk.path.split("/").pop() ?? `chunk-${chunk.index}.wav`, {
                  type: normalizeMimeType(chunkBlob.type || chunk.mimeType),
                }),
                startMs: chunk.startMs,
                endMs: chunk.endMs,
              };
            }),
          ),
          languageHint: lecture.language_hint,
          durationSeconds: lecture.duration_seconds,
        })
      : await (async () => {
          const storagePath = lecture.storage_path;

          if (!storagePath) {
            throw new Error("Lecture has no storage path.");
          }

          const { data: audioBlob, error: downloadError } = await supabase.storage
            .from("lecture-audio")
            .download(storagePath);

          if (downloadError) {
            throw downloadError;
          }

          const file = new File(
            [audioBlob],
            storagePath.split("/").pop() ?? "lecture.webm",
            {
              type: normalizeMimeType(audioBlob.type || "audio/webm"),
            },
          );

          return transcriptionProvider.transcribe({
            file,
            languageHint: lecture.language_hint,
            durationSeconds: lecture.duration_seconds,
          });
        })();

  assertTranscriptCoverage({
    transcript,
    expectedDurationSeconds: lecture.duration_seconds,
  });

  const embeddings: number[][] = [];

  for (let start = 0; start < transcript.segments.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = transcript.segments.slice(start, start + EMBEDDING_BATCH_SIZE);
    embeddings.push(
      ...(await createEmbeddings(batch.map((segment: { text: string }) => segment.text))),
    );
  }

  await supabase.from("transcript_segments").delete().eq("lecture_id", lecture.id);

  const transcriptRows = transcript.segments.map((segment: {
    idx: number;
    startMs: number;
    endMs: number;
    speakerLabel: string | null;
    text: string;
  }, index: number) => ({
    lecture_id: lecture.id,
    idx: segment.idx,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    speaker_label: segment.speakerLabel,
    text: segment.text,
    embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
  }));

  if (transcriptRows.length > 0) {
    const { error: insertTranscriptError } = await supabase
      .from("transcript_segments")
      .insert(transcriptRows as never);

    if (insertTranscriptError) {
      throw insertTranscriptError;
    }
  }

  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "generating_notes",
    durationSeconds: transcript.durationSeconds || lecture.duration_seconds,
  });
}

export async function generateLectureNotesFromStoredTranscript(params: { lectureId: string }) {
  const { supabase, lecture } = await getLectureForPipeline(params);
  const manualImportMetadata =
    lecture.processing_metadata &&
    typeof lecture.processing_metadata === "object" &&
    !Array.isArray(lecture.processing_metadata) &&
    "manualImport" in lecture.processing_metadata
      ? (lecture.processing_metadata as Record<string, unknown>).manualImport
      : null;

  const manualImportRecord =
    manualImportMetadata && typeof manualImportMetadata === "object" && !Array.isArray(manualImportMetadata)
      ? (manualImportMetadata as Record<string, unknown>)
      : null;

  const { data: transcriptSegments, error: transcriptError } = await supabase
    .from("transcript_segments")
    .select("idx, start_ms, end_ms, speaker_label, text")
    .eq("lecture_id", lecture.id)
    .order("idx", { ascending: true });

  if (transcriptError) {
    throw transcriptError;
  }

  let storedSegments = (transcriptSegments ?? []) as Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    speaker_label: string | null;
    text: string;
  }>;

  if (storedSegments.length === 0 && manualImportRecord) {
    const manualText =
      typeof manualImportRecord.text === "string" ? manualImportRecord.text.trim() : "";
    const manualBlocks = Array.isArray(manualImportRecord.blocks)
      ? (manualImportRecord.blocks as StructuredSourceBlock[])
      : undefined;
    const manualSourceType =
      typeof manualImportRecord.sourceType === "string"
        ? manualImportRecord.sourceType
        : lecture.source_type ?? "text";

    const syntheticSegments = buildSyntheticTranscriptFromTextSource({
      text: manualText,
      blocks: manualBlocks,
      sourceType: manualSourceType,
    });

    if (syntheticSegments.length === 0) {
      throw new Error("Transcript is empty.");
    }

    const embeddings: number[][] = [];

    for (let start = 0; start < syntheticSegments.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = syntheticSegments.slice(start, start + EMBEDDING_BATCH_SIZE);
      embeddings.push(
        ...(await createEmbeddings(batch.map((segment: { text: string }) => segment.text))),
      );
    }

    const transcriptRows = syntheticSegments.map((segment, index) => ({
      lecture_id: lecture.id,
      idx: segment.idx,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker_label: segment.speakerLabel,
      text: segment.text,
      embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
    }));

    const { error: insertTranscriptError } = await supabase
      .from("transcript_segments")
      .insert(transcriptRows as never);

    if (insertTranscriptError) {
      throw insertTranscriptError;
    }

    if (manualText.length > 0) {
      await updateLectureProcessingState({
        lectureId: lecture.id,
        processingMetadata: lecture.processing_metadata,
        stage: "generating_notes",
        durationSeconds:
          lecture.duration_seconds ?? estimateTextSourceDurationSeconds(manualText),
      });
    }

    storedSegments = transcriptRows.map((segment) => ({
      idx: segment.idx,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      speaker_label: segment.speaker_label,
      text: segment.text,
    }));
  }

  const segments = storedSegments.map((segment) => ({
    idx: segment.idx,
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    speakerLabel: segment.speaker_label,
    text: segment.text,
  }));

  if (segments.length === 0) {
    throw new Error("Transcript is empty.");
  }

  const sourceLabel =
    lecture.source_type === "audio"
      ? "lecture transcripts"
      : "uploaded documents and text sources";
  const pipelineName =
    lecture.source_type === "audio" ? "map-reduce-notes-v2" : "document-to-notes-v2";
  const sourceTitleHint =
    typeof lecture.title === "string" && lecture.title.trim().length > 0
      ? lecture.title
      : typeof manualImportRecord?.titleHint === "string"
        ? manualImportRecord.titleHint
        : undefined;

  const notes = await generateNotesFromTranscript(segments, {
    sourceLabel,
    pipelineName,
    sourceType: lecture.source_type === "audio" ? "audio" : "document",
    outputLanguage: lecture.language_hint,
    sourceTitleHint,
  });

  const manualModelMetadata =
    manualImportRecord?.modelMetadata &&
    typeof manualImportRecord.modelMetadata === "object" &&
    !Array.isArray(manualImportRecord.modelMetadata)
      ? (manualImportRecord.modelMetadata as Record<string, unknown>)
      : {};

  const { error: artifactError } = await supabase
    .from("lecture_artifacts")
    .upsert(
      {
        lecture_id: lecture.id,
        summary: notes.summary,
        key_topics: notes.keyTopics,
        structured_notes_md: notes.structuredNotesMd,
        model_metadata: {
          ...notes.modelMetadata,
          ...manualModelMetadata,
        },
      } as never,
      {
        onConflict: "lecture_id",
      },
    );

  if (artifactError) {
    throw artifactError;
  }

  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "ready",
    title: notes.title,
    durationSeconds: lecture.duration_seconds,
  });
}

export async function markLecturePipelineFailed(params: {
  lectureId: string;
  error: unknown;
}) {
  const { data: lecture } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .select("processing_metadata")
    .eq("id", params.lectureId)
    .maybeSingle();

  const lectureMetadata = lecture as { processing_metadata?: unknown } | null;

  await updateLectureProcessingState({
    lectureId: params.lectureId,
    processingMetadata: lectureMetadata?.processing_metadata ?? {},
    stage: "failed",
    errorMessage: toErrorMessage(params.error),
  });
}

export async function runLecturePipeline(params: { lectureId: string }) {
  try {
    await transcribeLectureContent(params);
    await generateLectureNotesFromStoredTranscript(params);
  } catch (error) {
    await markLecturePipelineFailed({
      lectureId: params.lectureId,
      error,
    });

    throw error;
  }
}

type RpcMatchResult = {
  id: string;
  lecture_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_label: string | null;
  text: string;
  similarity: number;
};

export async function answerLectureChat(params: {
  lectureId: string;
  userId: string;
  question: string;
}) {
  const supabase = createSupabaseServiceRoleClient();

  const [{ data: artifact }, { data: lecture }, embeddingResponse] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("*")
      .eq("lecture_id", params.lectureId)
      .maybeSingle(),
    supabase
      .from("lectures")
      .select("language_hint")
      .eq("id", params.lectureId)
      .maybeSingle(),
    createEmbeddings([params.question]),
  ]);

  const queryEmbedding = serializeVector(embeddingResponse[0]);
  const artifactRow = (artifact ?? null) as {
    summary: string;
    key_topics: string[];
  } | null;
  const lectureRow = (lecture ?? null) as { language_hint: string | null } | null;

  const { data: matches, error: matchError } = await supabase.rpc(
    "match_transcript_segments" as never,
    {
      filter_lecture_id: params.lectureId,
      match_count: CHAT_MATCH_COUNT,
      query_embedding: queryEmbedding,
    } as never,
  );

  if (matchError) {
    throw matchError as PostgrestError;
  }

  const context = (matches ?? []) as RpcMatchResult[];

  const answer = await generateStructuredObject({
    schema: chatAnswerSchema,
    schemaName: "chat_answer",
    instructions: `${buildGeneratedContentLanguageInstruction(lectureRow?.language_hint)} Answer the student using only the supplied lecture context. If the answer is not fully supported, say that the lecture does not clearly state it. Cite only transcript chunks that are genuinely relevant.`,
    input: JSON.stringify(
      {
        question: params.question,
        summary: artifactRow?.summary ?? null,
        keyTopics: artifactRow?.key_topics ?? [],
        context,
      },
      null,
      2,
    ),
  });

  const citations = answer.citations.map((citation) => ({
    idx: citation.idx,
    startMs: citation.startMs,
    endMs: citation.endMs,
    quote: citation.quote,
  }));

  const userMessage = {
    lecture_id: params.lectureId,
    user_id: params.userId,
    role: "user" as const,
    content: params.question,
    citations_json: [],
  };

  const assistantMessage = {
    lecture_id: params.lectureId,
    user_id: params.userId,
    role: "assistant" as const,
    content: answer.answer,
    citations_json: citations,
  };

  const { data: insertedMessages, error: insertError } = await supabase
    .from("chat_messages")
    .insert([userMessage, assistantMessage] as never)
    .select("*");

  if (insertError) {
    throw insertError;
  }

  const persistedMessages = (insertedMessages ?? []) as Array<{
    id: string;
    lecture_id: string;
    user_id: string;
    role: "user" | "assistant";
    content: string;
    citations_json: unknown;
    created_at: string;
  }>;

  const mapped = persistedMessages.map((message) => ({
    ...message,
    citations: Array.isArray(message.citations_json)
      ? (message.citations_json as unknown as ChatMessageWithCitations["citations"])
      : [],
  }));

  return {
    answer: mapped.find((message) => message.role === "assistant") ?? null,
    context,
  };
}
