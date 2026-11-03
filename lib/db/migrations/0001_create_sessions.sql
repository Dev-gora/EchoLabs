CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text,
  "session_id" text UNIQUE,
  "original_session_id" text,
  "attempt_number" integer DEFAULT 1,
  "mode" text DEFAULT 'general',
  "prompt_text" text DEFAULT '',
  "audio_url" text,
  "transcript" text NOT NULL,
  "duration_sec" real,
  "word_timestamps" jsonb,
  "metrics" jsonb,
  "acoustic_features" jsonb,
  "video_metrics" jsonb,
  "events" jsonb,
  "scores" jsonb,
  "content_analysis" jsonb,
  "unified_scores" jsonb,
  "feedback" jsonb,
  "event_feedback" jsonb,
  "grammar_mistakes" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "human_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" text NOT NULL,
  "rater_id" text,
  "ratings" jsonb NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
