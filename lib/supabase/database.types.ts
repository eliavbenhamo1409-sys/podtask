export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_usage_logs: {
        Row: {
          audio_seconds: number | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          institution_id: string | null
          metadata: Json
          model: string
          operation: Database["public"]["Enums"]["ai_operation"]
          output_tokens: number | null
          provider: string
          user_id: string | null
        }
        Insert: {
          audio_seconds?: number | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          institution_id?: string | null
          metadata?: Json
          model: string
          operation: Database["public"]["Enums"]["ai_operation"]
          output_tokens?: number | null
          provider: string
          user_id?: string | null
        }
        Update: {
          audio_seconds?: number | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          institution_id?: string | null
          metadata?: Json
          model?: string
          operation?: Database["public"]["Enums"]["ai_operation"]
          output_tokens?: number | null
          provider?: string
          user_id?: string | null
        }
        Relationships: []
      }
      answer_evaluations: {
        Row: {
          clarity_score: number | null
          conceptual_score: number | null
          consistency_score: number | null
          created_at: string
          evidence: Json | null
          gaps: Json | null
          id: string
          interview_id: string
          message_id: string | null
          model: string
          question_id: string | null
          raw_output: Json | null
          reasoning_score: number | null
          recommended_followup: string | null
          recommended_next_action: string | null
          understanding_level: Database["public"]["Enums"]["understanding_level"] | null
        }
        Insert: {
          interview_id: string
          model: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["answer_evaluations"]["Row"]>
        Relationships: []
      }
      assignments: {
        Row: {
          allow_audio_storage: boolean
          allow_transcript_visible_to_student: boolean
          course_id: string
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          instructions: string | null
          interview_duration_minutes: number
          language: string
          require_microphone_test: boolean
          settings: Json
          status: Database["public"]["Enums"]["assignment_status"]
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          title: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["assignments"]["Row"]>
        Relationships: []
      }
      course_members: {
        Row: {
          course_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["course_role"]
          user_id: string
        }
        Insert: {
          course_id: string
          user_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["course_members"]["Row"]>
        Relationships: []
      }
      courses: {
        Row: {
          code: string
          created_at: string
          id: string
          institution_id: string
          lecturer_name: string | null
          name: string
          semester: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          institution_id: string
          name: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["courses"]["Row"]>
        Relationships: []
      }
      document_analyses: {
        Row: {
          claims: Json
          complex_sections: Json
          created_at: string
          id: string
          interview_targets: Json
          key_concepts: Json
          main_argument: string | null
          methodology: Json | null
          model: string
          raw_output: Json | null
          submission_id: string
          summary: string | null
          weak_points: Json
        }
        Insert: {
          model: string
          submission_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["document_analyses"]["Row"]>
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          heading: string | null
          id: string
          metadata: Json
          page_end: number | null
          page_start: number | null
          submission_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          submission_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["document_chunks"]["Row"]>
        Relationships: []
      }
      document_parses: {
        Row: {
          created_at: string
          id: string
          markdown: string | null
          metadata: Json
          page_count: number | null
          provider: Database["public"]["Enums"]["parse_provider"]
          submission_id: string
        }
        Insert: {
          provider: Database["public"]["Enums"]["parse_provider"]
          submission_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["document_parses"]["Row"]>
        Relationships: []
      }
      institutions: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          name: string
          slug: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["institutions"]["Row"]>
        Relationships: []
      }
      interview_messages: {
        Row: {
          audio_path: string | null
          content: string | null
          created_at: string
          ended_at: string | null
          id: string
          interview_id: string
          message_type: Database["public"]["Enums"]["interview_message_type"]
          metadata: Json
          speaker: Database["public"]["Enums"]["interview_speaker"]
          started_at: string | null
        }
        Insert: {
          interview_id: string
          message_type: Database["public"]["Enums"]["interview_message_type"]
          speaker: Database["public"]["Enums"]["interview_speaker"]
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["interview_messages"]["Row"]>
        Relationships: []
      }
      interview_plans: {
        Row: {
          created_at: string
          id: string
          interview_id: string
          model: string
          plan: Json
        }
        Insert: {
          interview_id: string
          model: string
          plan: Json
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["interview_plans"]["Row"]>
        Relationships: []
      }
      interviews: {
        Row: {
          assignment_id: string
          audio_path: string | null
          completed_at: string | null
          created_at: string
          current_state: Database["public"]["Enums"]["interview_runtime_state"]
          duration_seconds: number | null
          id: string
          language: string
          metadata: Json
          started_at: string | null
          status: Database["public"]["Enums"]["interview_status"]
          student_id: string
          submission_id: string
          transcript_path: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          student_id: string
          submission_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["interviews"]["Row"]>
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          institution_id: string | null
          locale: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          email: string
          id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>
        Relationships: []
      }
      rate_limit_events: {
        Row: {
          count: number
          created_at: string
          id: string
          key: string
          user_id: string | null
          window_start: string
        }
        Insert: {
          key: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["rate_limit_events"]["Row"]>
        Relationships: []
      }
      reports: {
        Row: {
          assignment_id: string
          created_at: string
          evidence: Json | null
          gaps: Json | null
          id: string
          interview_id: string
          overall_level: Database["public"]["Enums"]["understanding_level"] | null
          pdf_path: string | null
          recommendations: Json | null
          rubric_result: Json | null
          status: Database["public"]["Enums"]["report_status"]
          student_id: string
          submission_id: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          interview_id: string
          student_id: string
          submission_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["reports"]["Row"]>
        Relationships: []
      }
      submissions: {
        Row: {
          assignment_id: string
          created_at: string
          failure_reason: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          original_filename: string | null
          status: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          student_id: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["submissions"]["Row"]>
        Relationships: []
      }
      system_events: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          entity_type: string
          event_type: string
          [key: string]: unknown
        }
        Update: Partial<Database["public"]["Tables"]["system_events"]["Row"]>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      ai_operation:
        | "parse_document"
        | "embed_chunks"
        | "analyze_assignment"
        | "generate_interview_plan"
        | "realtime_voice"
        | "evaluate_answer"
        | "generate_report"
      app_role: "student" | "lecturer" | "admin"
      assignment_status: "draft" | "published" | "closed" | "archived"
      course_role: "student" | "lecturer" | "ta"
      interview_message_type:
        | "question"
        | "answer"
        | "followup"
        | "system"
        | "summary"
      interview_runtime_state:
        | "idle"
        | "connecting"
        | "host_intro"
        | "ai_speaking"
        | "student_turn"
        | "student_recording"
        | "transcribing"
        | "evaluating_answer"
        | "followup"
        | "closing"
        | "completed"
        | "failed"
      interview_speaker: "ai_host" | "student" | "system"
      interview_status:
        | "created"
        | "ready"
        | "starting"
        | "in_progress"
        | "paused"
        | "completed"
        | "failed"
        | "cancelled"
      parse_provider: "mistral_ocr" | "llamaparse" | "manual_text"
      report_status: "draft" | "ready" | "reviewed" | "flagged"
      student_assignment_status:
        | "not_started"
        | "upload_required"
        | "processing"
        | "ready_for_interview"
        | "mic_test_required"
        | "interview_in_progress"
        | "completed"
        | "failed"
      submission_status:
        | "uploaded"
        | "parsing"
        | "parsed"
        | "analyzing"
        | "analysis_ready"
        | "interview_ready"
        | "interview_completed"
        | "report_ready"
        | "failed"
      understanding_level: "low" | "medium" | "medium_high" | "high"
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T]
