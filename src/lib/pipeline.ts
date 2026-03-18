import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { chatAnswerSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { CHAT_MATCH_COUNT } from "@/lib/constants";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import type { ChatMessageWithCitations } from "@/lib/types";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { normalizeMimeType } from "@/lib/storage";
import { serializeVector } from "@/lib/utils";
import { OpenAiTranscriptionProvider } from "@/lib/transcription/openai";
import { getOpenAiClient } from "@/lib/ai/openai";
import { getServerEnv } from "@/lib/server-env";

const transcriptionProvider = new OpenAiTranscriptionProvider();

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown processing error.";
}

async function createEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const openai = getOpenAiClient();
  const response = await openai.embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

export async function runLecturePipeline(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();

  try {
    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .select("*")
      .eq("id", params.lectureId)
      .single();

    if (lectureError) {
      throw lectureError;
    }

    const lectureRow = lecture as {
      id: string;
      storage_path: string | null;
      language_hint: string | null;
      duration_seconds: number | null;
    };

    if (!lectureRow.storage_path) {
      throw new Error("Lecture has no storage path.");
    }

    await supabase
      .from("lectures")
      .update(
        {
          status: "transcribing",
          error_message: null,
        } as never,
      )
      .eq("id", lectureRow.id);

    const { data: audioBlob, error: downloadError } = await supabase.storage
      .from("lecture-audio")
      .download(lectureRow.storage_path);

    if (downloadError) {
      throw downloadError;
    }

    const file = new File(
      [audioBlob],
      lectureRow.storage_path.split("/").pop() ?? "lecture.webm",
      {
        type: normalizeMimeType(audioBlob.type || "audio/webm"),
      },
    );

    const transcript = await transcriptionProvider.transcribe({
      file,
      languageHint: lectureRow.language_hint,
      durationSeconds: lectureRow.duration_seconds,
    });

    const embeddings = await createEmbeddings(
      transcript.segments.map((segment) => segment.text),
    );

    await supabase.from("transcript_segments").delete().eq("lecture_id", lectureRow.id);

    const transcriptRows = transcript.segments.map((segment, index) => ({
      lecture_id: lectureRow.id,
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

    await supabase
      .from("lectures")
      .update(
        {
          duration_seconds: transcript.durationSeconds || lectureRow.duration_seconds,
          status: "generating_notes",
        } as never,
      )
      .eq("id", lectureRow.id);

    const notes = await generateNotesFromTranscript(transcript.segments, {
      sourceLabel: "lecture transcripts",
      pipelineName: "map-reduce-notes-v2",
      outputLanguage: lectureRow.language_hint,
    });

    const { error: artifactError } = await supabase
      .from("lecture_artifacts")
      .upsert(
        {
          lecture_id: lectureRow.id,
          summary: notes.summary,
          key_topics: notes.keyTopics,
          structured_notes_md: notes.structuredNotesMd,
          model_metadata: notes.modelMetadata,
        } as never,
        {
          onConflict: "lecture_id",
        },
      );

    if (artifactError) {
      throw artifactError;
    }

    const { error: lectureUpdateError } = await supabase
      .from("lectures")
      .update(
        {
          title: notes.title,
          status: "ready",
          error_message: null,
          duration_seconds: transcript.durationSeconds || lectureRow.duration_seconds,
        } as never,
      )
      .eq("id", lectureRow.id);

    if (lectureUpdateError) {
      throw lectureUpdateError;
    }
  } catch (error) {
    await createSupabaseServiceRoleClient()
      .from("lectures")
      .update(
        {
          status: "failed",
          error_message: toErrorMessage(error),
        } as never,
      )
      .eq("id", params.lectureId);

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
  const env = getServerEnv();
  const openai = getOpenAiClient();

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
    openai.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: params.question,
    }),
  ]);

  const queryEmbedding = serializeVector(embeddingResponse.data[0].embedding);
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
