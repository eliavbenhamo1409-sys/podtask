// GENERATED from the Supabase schema (project jxlrpewoqikpswxmtdma) — do not
// hand-edit table types. Regenerate with the Supabase MCP tool
// `generate_typescript_types` (or `supabase gen types typescript --linked`)
// after every migration. Last generated after
// 20260514000001_integrity_foundation.sql.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          understanding_level:
            | Database["public"]["Enums"]["understanding_level"]
            | null
        }
        Insert: {
          clarity_score?: number | null
          conceptual_score?: number | null
          consistency_score?: number | null
          created_at?: string
          evidence?: Json | null
          gaps?: Json | null
          id?: string
          interview_id: string
          message_id?: string | null
          model: string
          question_id?: string | null
          raw_output?: Json | null
          reasoning_score?: number | null
          recommended_followup?: string | null
          recommended_next_action?: string | null
          understanding_level?:
            | Database["public"]["Enums"]["understanding_level"]
            | null
        }
        Update: {
          clarity_score?: number | null
          conceptual_score?: number | null
          consistency_score?: number | null
          created_at?: string
          evidence?: Json | null
          gaps?: Json | null
          id?: string
          interview_id?: string
          message_id?: string | null
          model?: string
          question_id?: string | null
          raw_output?: Json | null
          reasoning_score?: number | null
          recommended_followup?: string | null
          recommended_next_action?: string | null
          understanding_level?:
            | Database["public"]["Enums"]["understanding_level"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "answer_evaluations_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_evaluations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "interview_messages"
            referencedColumns: ["id"]
          },
        ]
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
          allow_audio_storage?: boolean
          allow_transcript_visible_to_student?: boolean
          course_id: string
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          instructions?: string | null
          interview_duration_minutes?: number
          language?: string
          require_microphone_test?: boolean
          settings?: Json
          status?: Database["public"]["Enums"]["assignment_status"]
          title: string
          updated_at?: string
        }
        Update: {
          allow_audio_storage?: boolean
          allow_transcript_visible_to_student?: boolean
          course_id?: string
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          instructions?: string | null
          interview_duration_minutes?: number
          language?: string
          require_microphone_test?: boolean
          settings?: Json
          status?: Database["public"]["Enums"]["assignment_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["course_role"]
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["course_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_members_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          id?: string
          institution_id: string
          lecturer_name?: string | null
          name: string
          semester?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          institution_id?: string
          lecturer_name?: string | null
          name?: string
          semester?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
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
          claims?: Json
          complex_sections?: Json
          created_at?: string
          id?: string
          interview_targets?: Json
          key_concepts?: Json
          main_argument?: string | null
          methodology?: Json | null
          model: string
          raw_output?: Json | null
          submission_id: string
          summary?: string | null
          weak_points?: Json
        }
        Update: {
          claims?: Json
          complex_sections?: Json
          created_at?: string
          id?: string
          interview_targets?: Json
          key_concepts?: Json
          main_argument?: string | null
          methodology?: Json | null
          model?: string
          raw_output?: Json | null
          submission_id?: string
          summary?: string | null
          weak_points?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_analyses_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          embedding?: string | null
          heading?: string | null
          id?: string
          metadata?: Json
          page_end?: number | null
          page_start?: number | null
          submission_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          heading?: string | null
          id?: string
          metadata?: Json
          page_end?: number | null
          page_start?: number | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          id?: string
          markdown?: string | null
          metadata?: Json
          page_count?: number | null
          provider: Database["public"]["Enums"]["parse_provider"]
          submission_id: string
        }
        Update: {
          created_at?: string
          id?: string
          markdown?: string | null
          metadata?: Json
          page_count?: number | null
          provider?: Database["public"]["Enums"]["parse_provider"]
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_parses_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      interview_consents: {
        Row: {
          accepted_at: string
          id: string
          interview_id: string
          locale: string
          student_id: string
          user_agent: string | null
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          interview_id: string
          locale?: string
          student_id: string
          user_agent?: string | null
          version: string
        }
        Update: {
          accepted_at?: string
          id?: string
          interview_id?: string
          locale?: string
          student_id?: string
          user_agent?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_consents_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_consents_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_flags: {
        Row: {
          category: string
          confidence: string
          created_at: string
          description: string
          evidence: Json
          id: string
          interview_id: string
          limitations: string | null
          message_id: string | null
          needs_human_review: boolean
          plan_question_id: string | null
          quote: string | null
          source: string
          student_id: string
        }
        Insert: {
          category: string
          confidence?: string
          created_at?: string
          description: string
          evidence?: Json
          id?: string
          interview_id: string
          limitations?: string | null
          message_id?: string | null
          needs_human_review?: boolean
          plan_question_id?: string | null
          quote?: string | null
          source: string
          student_id: string
        }
        Update: {
          category?: string
          confidence?: string
          created_at?: string
          description?: string
          evidence?: Json
          id?: string
          interview_id?: string
          limitations?: string | null
          message_id?: string | null
          needs_human_review?: boolean
          plan_question_id?: string | null
          quote?: string | null
          source?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_flags_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_flags_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "interview_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_flags_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_integrity_events: {
        Row: {
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          id: string
          interview_id: string
          kind: string
          payload: Json
          plan_question_id: string | null
          source: string
          started_at: string
          student_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          id?: string
          interview_id: string
          kind: string
          payload?: Json
          plan_question_id?: string | null
          source?: string
          started_at?: string
          student_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          id?: string
          interview_id?: string
          kind?: string
          payload?: Json
          plan_question_id?: string | null
          source?: string
          started_at?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_integrity_events_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_integrity_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          plan_question_id: string | null
          speaker: Database["public"]["Enums"]["interview_speaker"]
          started_at: string | null
        }
        Insert: {
          audio_path?: string | null
          content?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          interview_id: string
          message_type: Database["public"]["Enums"]["interview_message_type"]
          metadata?: Json
          plan_question_id?: string | null
          speaker: Database["public"]["Enums"]["interview_speaker"]
          started_at?: string | null
        }
        Update: {
          audio_path?: string | null
          content?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          interview_id?: string
          message_type?: Database["public"]["Enums"]["interview_message_type"]
          metadata?: Json
          plan_question_id?: string | null
          speaker?: Database["public"]["Enums"]["interview_speaker"]
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_messages_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          id?: string
          interview_id: string
          model: string
          plan: Json
        }
        Update: {
          created_at?: string
          id?: string
          interview_id?: string
          model?: string
          plan?: Json
        }
        Relationships: [
          {
            foreignKeyName: "interview_plans_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_reviews: {
        Row: {
          follow_up_requested: boolean
          interview_id: string
          note: string | null
          reviewer_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          follow_up_requested?: boolean
          interview_id: string
          note?: string | null
          reviewer_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          follow_up_requested?: boolean
          interview_id?: string
          note?: string | null
          reviewer_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_reviews_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          audio_path?: string | null
          completed_at?: string | null
          created_at?: string
          current_state?: Database["public"]["Enums"]["interview_runtime_state"]
          duration_seconds?: number | null
          id?: string
          language?: string
          metadata?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          student_id: string
          submission_id: string
          transcript_path?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          audio_path?: string | null
          completed_at?: string | null
          created_at?: string
          current_state?: Database["public"]["Enums"]["interview_runtime_state"]
          duration_seconds?: number | null
          id?: string
          language?: string
          metadata?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          student_id?: string
          submission_id?: string
          transcript_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
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
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          institution_id?: string | null
          locale?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          institution_id?: string | null
          locale?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
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
          count?: number
          created_at?: string
          id?: string
          key: string
          user_id?: string | null
          window_start?: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          key?: string
          user_id?: string | null
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          assignment_id: string
          created_at: string
          evidence: Json | null
          gaps: Json | null
          id: string
          interview_id: string
          overall_level:
            | Database["public"]["Enums"]["understanding_level"]
            | null
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
          created_at?: string
          evidence?: Json | null
          gaps?: Json | null
          id?: string
          interview_id: string
          overall_level?:
            | Database["public"]["Enums"]["understanding_level"]
            | null
          pdf_path?: string | null
          recommendations?: Json | null
          rubric_result?: Json | null
          status?: Database["public"]["Enums"]["report_status"]
          student_id: string
          submission_id: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          evidence?: Json | null
          gaps?: Json | null
          id?: string
          interview_id?: string
          overall_level?:
            | Database["public"]["Enums"]["understanding_level"]
            | null
          pdf_path?: string | null
          recommendations?: Json | null
          rubric_result?: Json | null
          status?: Database["public"]["Enums"]["report_status"]
          student_id?: string
          submission_id?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
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
          created_at?: string
          failure_reason?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          failure_reason?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_account: {
        Args: {
          p_courses?: string[]
          p_full_name: string
          p_institution_id?: string
          p_locale?: string
          p_password?: string
          p_role?: Database["public"]["Enums"]["app_role"]
          p_username: string
        }
        Returns: Json
      }
      admin_set_password: {
        Args: { p_password?: string; p_username: string }
        Returns: Json
      }
      create_personal_assignment: {
        Args: { p_language?: string; p_title: string }
        Returns: string
      }
      interview_outline: { Args: { p_interview_id: string }; Returns: Json }
      lecturer_add_course_members: {
        Args: { p_course_id: string; p_emails: string[] }
        Returns: Json
      }
      lecturer_create_course: {
        Args: { p_code: string; p_name: string; p_semester?: string }
        Returns: string
      }
    }
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
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_operation: [
        "parse_document",
        "embed_chunks",
        "analyze_assignment",
        "generate_interview_plan",
        "realtime_voice",
        "evaluate_answer",
        "generate_report",
      ],
      app_role: ["student", "lecturer", "admin"],
      assignment_status: ["draft", "published", "closed", "archived"],
      course_role: ["student", "lecturer", "ta"],
      interview_message_type: [
        "question",
        "answer",
        "followup",
        "system",
        "summary",
      ],
      interview_runtime_state: [
        "idle",
        "connecting",
        "host_intro",
        "ai_speaking",
        "student_turn",
        "student_recording",
        "transcribing",
        "evaluating_answer",
        "followup",
        "closing",
        "completed",
        "failed",
      ],
      interview_speaker: ["ai_host", "student", "system"],
      interview_status: [
        "created",
        "ready",
        "starting",
        "in_progress",
        "paused",
        "completed",
        "failed",
        "cancelled",
      ],
      parse_provider: ["mistral_ocr", "llamaparse", "manual_text"],
      report_status: ["draft", "ready", "reviewed", "flagged"],
      student_assignment_status: [
        "not_started",
        "upload_required",
        "processing",
        "ready_for_interview",
        "mic_test_required",
        "interview_in_progress",
        "completed",
        "failed",
      ],
      submission_status: [
        "uploaded",
        "parsing",
        "parsed",
        "analyzing",
        "analysis_ready",
        "interview_ready",
        "interview_completed",
        "report_ready",
        "failed",
      ],
      understanding_level: ["low", "medium", "medium_high", "high"],
    },
  },
} as const
