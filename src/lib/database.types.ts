export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type LectureStatus =
  | "uploading"
  | "queued"
  | "transcribing"
  | "generating_notes"
  | "ready"
  | "failed";

export type StudyAssetStatus =
  | "queued"
  | "generating"
  | "ready"
  | "failed";

export type FlashcardDifficulty = "easy" | "medium" | "hard";
export type FlashcardConfidenceBucket = "again" | "good" | "easy";

export interface Citation {
  idx: number;
  startMs: number;
  endMs: number;
  quote: string;
}

export type Database = {
  public: {
    Tables: {
      email_auth_requests: {
        Row: {
          id: number;
          email: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          email: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          email?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
          updated_at: string;
          onboarding_completed_at: string | null;
          age_range: string | null;
          education_level: string | null;
          current_average_grade: string | null;
          target_grade: string | null;
          study_goal: string | null;
          stripe_customer_id: string | null;
          trial_lecture_id: string | null;
          trial_started_at: string | null;
          trial_consumed_at: string | null;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
          onboarding_completed_at?: string | null;
          age_range?: string | null;
          education_level?: string | null;
          current_average_grade?: string | null;
          target_grade?: string | null;
          study_goal?: string | null;
          stripe_customer_id?: string | null;
          trial_lecture_id?: string | null;
          trial_started_at?: string | null;
          trial_consumed_at?: string | null;
        };
        Update: {
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
          onboarding_completed_at?: string | null;
          age_range?: string | null;
          education_level?: string | null;
          current_average_grade?: string | null;
          target_grade?: string | null;
          study_goal?: string | null;
          stripe_customer_id?: string | null;
          trial_lecture_id?: string | null;
          trial_started_at?: string | null;
          trial_consumed_at?: string | null;
        };
      };
      billing_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string;
          stripe_price_id: string | null;
          plan: "weekly" | "monthly" | "yearly";
          status:
            | "incomplete"
            | "incomplete_expired"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          currency: string;
          unit_amount: number | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id: string;
          stripe_price_id?: string | null;
          plan: "weekly" | "monthly" | "yearly";
          status:
            | "incomplete"
            | "incomplete_expired"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          currency?: string;
          unit_amount?: number | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string;
          stripe_price_id?: string | null;
          plan?: "weekly" | "monthly" | "yearly";
          status?:
            | "incomplete"
            | "incomplete_expired"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          currency?: string;
          unit_amount?: number | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      lectures: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          source_type: string;
          access_tier: "paid" | "trial";
          storage_path: string | null;
          processing_metadata: Json;
          duration_seconds: number | null;
          status: LectureStatus;
          language_hint: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          source_type: string;
          access_tier?: "paid" | "trial";
          storage_path?: string | null;
          processing_metadata?: Json;
          duration_seconds?: number | null;
          status?: LectureStatus;
          language_hint?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string | null;
          source_type?: string;
          access_tier?: "paid" | "trial";
          storage_path?: string | null;
          processing_metadata?: Json;
          duration_seconds?: number | null;
          status?: LectureStatus;
          language_hint?: string | null;
          error_message?: string | null;
          updated_at?: string;
        };
      };
      transcript_segments: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          start_ms: number;
          end_ms: number;
          speaker_label: string | null;
          text: string;
          embedding: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          start_ms: number;
          end_ms: number;
          speaker_label?: string | null;
          text: string;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          idx?: number;
          start_ms?: number;
          end_ms?: number;
          speaker_label?: string | null;
          text?: string;
          embedding?: string | null;
        };
      };
      lecture_artifacts: {
        Row: {
          lecture_id: string;
          summary: string;
          key_topics: string[];
          structured_notes_md: string;
          model_metadata: Json;
          generated_at: string;
        };
        Insert: {
          lecture_id: string;
          summary: string;
          key_topics: string[];
          structured_notes_md: string;
          model_metadata?: Json;
          generated_at?: string;
        };
        Update: {
          summary?: string;
          key_topics?: string[];
          structured_notes_md?: string;
          model_metadata?: Json;
          generated_at?: string;
        };
      };
      chat_messages: {
        Row: {
          id: string;
          lecture_id: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          citations_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          citations_json?: Json;
          created_at?: string;
        };
        Update: {
          content?: string;
          citations_json?: Json;
        };
      };
      lecture_study_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_quiz_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_practice_test_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_study_sections: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          title: string;
          source_label: string | null;
          source_start_ms: number | null;
          source_end_ms: number | null;
          source_page_start: number | null;
          source_page_end: number | null;
          unit_start_idx: number;
          unit_end_idx: number;
          card_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          title: string;
          source_label?: string | null;
          source_start_ms?: number | null;
          source_end_ms?: number | null;
          source_page_start?: number | null;
          source_page_end?: number | null;
          unit_start_idx: number;
          unit_end_idx: number;
          card_count?: number;
          created_at?: string;
        };
        Update: {
          idx?: number;
          title?: string;
          source_label?: string | null;
          source_start_ms?: number | null;
          source_end_ms?: number | null;
          source_page_start?: number | null;
          source_page_end?: number | null;
          unit_start_idx?: number;
          unit_end_idx?: number;
          card_count?: number;
        };
      };
      flashcards: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          front: string;
          back: string;
          hint: string | null;
          citations_json: Json;
          difficulty: FlashcardDifficulty;
          section_id: string | null;
          source_unit_idx: number;
          card_kind: string;
          concept_key: string;
          source_type: string;
          source_locator: string | null;
          coverage_rank: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          front: string;
          back: string;
          hint?: string | null;
          citations_json?: Json;
          difficulty: FlashcardDifficulty;
          section_id?: string | null;
          source_unit_idx?: number;
          card_kind?: string;
          concept_key?: string;
          source_type?: string;
          source_locator?: string | null;
          coverage_rank?: number;
          created_at?: string;
        };
        Update: {
          idx?: number;
          front?: string;
          back?: string;
          hint?: string | null;
          citations_json?: Json;
          difficulty?: FlashcardDifficulty;
          section_id?: string | null;
          source_unit_idx?: number;
          card_kind?: string;
          concept_key?: string;
          source_type?: string;
          source_locator?: string | null;
          coverage_rank?: number;
        };
      };
      flashcard_progress: {
        Row: {
          user_id: string;
          flashcard_id: string;
          confidence_bucket: FlashcardConfidenceBucket;
          review_count: number;
          last_reviewed_at: string | null;
        };
        Insert: {
          user_id: string;
          flashcard_id: string;
          confidence_bucket?: FlashcardConfidenceBucket;
          review_count?: number;
          last_reviewed_at?: string | null;
        };
        Update: {
          confidence_bucket?: FlashcardConfidenceBucket;
          review_count?: number;
          last_reviewed_at?: string | null;
        };
      };
      lecture_study_sessions: {
        Row: {
          user_id: string;
          lecture_id: string;
          active_study_view: "flashcards" | "quiz" | "practice_test";
          flashcard_state: Json | null;
          quiz_state: Json | null;
          practice_test_state: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          lecture_id: string;
          active_study_view?: "flashcards" | "quiz" | "practice_test";
          flashcard_state?: Json | null;
          quiz_state?: Json | null;
          practice_test_state?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          active_study_view?: "flashcards" | "quiz" | "practice_test";
          flashcard_state?: Json | null;
          quiz_state?: Json | null;
          practice_test_state?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      quiz_questions: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          options_json: Json;
          correct_option_idx: number;
          explanation: string;
          difficulty: FlashcardDifficulty;
          source_locator: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          options_json?: Json;
          correct_option_idx: number;
          explanation: string;
          difficulty: FlashcardDifficulty;
          source_locator?: string | null;
          created_at?: string;
        };
        Update: {
          idx?: number;
          prompt?: string;
          options_json?: Json;
          correct_option_idx?: number;
          explanation?: string;
          difficulty?: FlashcardDifficulty;
          source_locator?: string | null;
        };
      };
      practice_test_questions: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          answer_guide: string;
          difficulty: FlashcardDifficulty;
          source_locator: string | null;
          source_unit_idx: number | null;
          concept_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          answer_guide: string;
          difficulty: FlashcardDifficulty;
          source_locator?: string | null;
          source_unit_idx?: number | null;
          concept_key?: string | null;
          created_at?: string;
        };
        Update: {
          idx?: number;
          prompt?: string;
          answer_guide?: string;
          difficulty?: FlashcardDifficulty;
          source_locator?: string | null;
          source_unit_idx?: number | null;
          concept_key?: string | null;
        };
      };
      practice_test_attempts: {
        Row: {
          id: string;
          lecture_id: string;
          user_id: string;
          status: "in_progress" | "submitted" | "graded" | "failed";
          question_count: number;
          total_score: number | null;
          max_score: number | null;
          percentage: number | null;
          graded_at: string | null;
          model_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          user_id: string;
          status?: "in_progress" | "submitted" | "graded" | "failed";
          question_count: number;
          total_score?: number | null;
          max_score?: number | null;
          percentage?: number | null;
          graded_at?: string | null;
          model_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "in_progress" | "submitted" | "graded" | "failed";
          question_count?: number;
          total_score?: number | null;
          max_score?: number | null;
          percentage?: number | null;
          graded_at?: string | null;
          model_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      practice_test_attempt_answers: {
        Row: {
          id: string;
          attempt_id: string;
          practice_test_question_id: string | null;
          idx: number;
          question_prompt: string | null;
          answer_guide_snapshot: string | null;
          difficulty_snapshot: string | null;
          source_locator_snapshot: string | null;
          typed_answer: string | null;
          photo_path: string | null;
          photo_mime_type: string | null;
          declared_unknown: boolean;
          score: number | null;
          grading_rationale: string | null;
          strengths: string | null;
          missing_points: string | null;
          expected_answer: string | null;
          grading_confidence: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          practice_test_question_id?: string | null;
          idx: number;
          question_prompt?: string | null;
          answer_guide_snapshot?: string | null;
          difficulty_snapshot?: string | null;
          source_locator_snapshot?: string | null;
          typed_answer?: string | null;
          photo_path?: string | null;
          photo_mime_type?: string | null;
          declared_unknown?: boolean;
          score?: number | null;
          grading_rationale?: string | null;
          strengths?: string | null;
          missing_points?: string | null;
          expected_answer?: string | null;
          grading_confidence?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          practice_test_question_id?: string | null;
          question_prompt?: string | null;
          answer_guide_snapshot?: string | null;
          difficulty_snapshot?: string | null;
          source_locator_snapshot?: string | null;
          typed_answer?: string | null;
          photo_path?: string | null;
          photo_mime_type?: string | null;
          declared_unknown?: boolean;
          score?: number | null;
          grading_rationale?: string | null;
          strengths?: string | null;
          missing_points?: string | null;
          expected_answer?: string | null;
          grading_confidence?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_transcript_segments: {
        Args: {
          filter_lecture_id: string;
          match_count: number;
          query_embedding: string;
        };
        Returns: {
          id: string;
          lecture_id: string;
          idx: number;
          start_ms: number;
          end_ms: number;
          speaker_label: string | null;
          text: string;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type BillingSubscriptionRow =
  Database["public"]["Tables"]["billing_subscriptions"]["Row"];
export type LectureRow = Database["public"]["Tables"]["lectures"]["Row"];
export type TranscriptSegmentRow =
  Database["public"]["Tables"]["transcript_segments"]["Row"];
export type LectureArtifactRow =
  Database["public"]["Tables"]["lecture_artifacts"]["Row"];
export type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
export type LectureStudyAssetRow =
  Database["public"]["Tables"]["lecture_study_assets"]["Row"];
export type LectureQuizAssetRow =
  Database["public"]["Tables"]["lecture_quiz_assets"]["Row"];
export type LecturePracticeTestAssetRow =
  Database["public"]["Tables"]["lecture_practice_test_assets"]["Row"];
export type LectureStudySectionRow =
  Database["public"]["Tables"]["lecture_study_sections"]["Row"];
export type FlashcardRow = Database["public"]["Tables"]["flashcards"]["Row"];
export type FlashcardProgressRow =
  Database["public"]["Tables"]["flashcard_progress"]["Row"];
export type LectureStudySessionRow =
  Database["public"]["Tables"]["lecture_study_sessions"]["Row"];
export type QuizQuestionRow = Database["public"]["Tables"]["quiz_questions"]["Row"];
export type PracticeTestQuestionRow =
  Database["public"]["Tables"]["practice_test_questions"]["Row"];
export type PracticeTestAttemptRow =
  Database["public"]["Tables"]["practice_test_attempts"]["Row"];
export type PracticeTestAttemptAnswerRow =
  Database["public"]["Tables"]["practice_test_attempt_answers"]["Row"];
