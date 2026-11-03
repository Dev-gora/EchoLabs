import { pgTable, text, integer, real, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id"),
  session_id: text("session_id").unique(),
  original_session_id: text("original_session_id"),
  attempt_number: integer("attempt_number").default(1),
  mode: text("mode").default("general"),
  prompt_text: text("prompt_text").default(""),
  audio_url: text("audio_url"),
  transcript: text("transcript").notNull(),
  duration_sec: real("duration_sec"),
  // word timestamps
  word_timestamps: jsonb("word_timestamps"),
  // Step 1 metrics
  metrics: jsonb("metrics"),
  // Step 2 acoustics
  acoustic_features: jsonb("acoustic_features"),
  // Step 5 video metrics
  video_metrics: jsonb("video_metrics"),
  // Step 4 events
  events: jsonb("events"),
  // Step 1 scores / Step 3 content
  scores: jsonb("scores"),
  content_analysis: jsonb("content_analysis"),
  // Step 4 unified scores
  unified_scores: jsonb("unified_scores"),
  // Step 4 feedback
  feedback: jsonb("feedback"),
  event_feedback: jsonb("event_feedback"),
  // grammar mistakes
  grammar_mistakes: jsonb("grammar_mistakes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const humanRatingsTable = pgTable("human_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  session_id: text("session_id").notNull(),
  rater_id: text("rater_id"),
  ratings: jsonb("ratings").notNull(), // per dimension including video
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});
