/**
 * Supabase client for EchoLabs — per-user authenticated client.
 *
 * Each signed-in user gets their own Supabase client configured with their
 * Clerk JWT as the access token.  Row-level security (RLS) in your Supabase
 * project then enforces that users can only see their own rows.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Env vars expected at build time — set these in your .env / Vite config */
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.YourAnonKey';

/** Base client used to fetch a fresh JWT for the current user. */
const baseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type EchoLabsSupabaseClient = SupabaseClient;

/**
 * Create a Supabase client bound to a specific Clerk user.
 *
 * Pass the JWT from Clerk's `getToken()` (or `session.token`) so RLS
 * policies see `auth.jwt()->sub` / `auth.jwt()->user_id` as the user.
 */
export function createUserClient(
  jwt: string,
  options?: ConstructorParameters<typeof SupabaseClient>[2],
): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      accessToken: jwt,
      autoRefreshToken: false,
      persistSession: false,
    },
    ...options,
  });
}

/**
 * Build a fresh per-user client from a Clerk session/token.
 * Call this after `useAuth()` resolves and you have a token.
 */
export async function getAuthenticatedClient(
  getToken: () => Promise<string | null> | string | null,
): Promise<SupabaseClient> {
  const token = await getToken();
  if (!token) {
    // Fall back to the anon client so the app still works (will hit RLS
    // deny policies for protected tables).
    return baseClient;
  }
  return createUserClient(token);
}

/**
 * Simple query helpers that always scope to the current user's rows
 * via RLS.  The real safety net is the RLS policy in your Supabase
 * project, but these helpers make the intent explicit.
 */

export async function fetchUserSessions(
  client: SupabaseClient,
  userId: string,
): Promise<Array<{
  id: string
  score: number | null
  status: string
  date: string
  transcript?: string
  duration_sec?: number
}>> {
  const { data, error } = await client
    .from('sessions')
    .select('id, score, status, date, transcript, duration_sec')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Array<{
    id: string
    score: number | null
    status: string
    date: string
    transcript?: string
    duration_sec?: number
  }>;
}

export async function insertSession(
  client: SupabaseClient,
  session: {
    user_id: string
    score: number | null
    status: string
    date: string
    transcript?: string
    duration_sec?: number
    camera_id?: string
    mic_id?: string
  },
): Promise<string | null> {
  const { data, error } = await client
    .from('sessions')
    .insert([session])
    .select('id')
    .single();

  if (error) throw error;
  return data?.id ?? null;
}

export async function updateSessionScore(
  client: SupabaseClient,
  sessionId: string,
  score: number,
  mistakes: Array<{ time: number; label: string; kind: string }>,
): Promise<void> {
  const { error } = await client
    .from('sessions')
    .update({ score, mistakes: JSON.stringify(mistakes) })
    .eq('id', sessionId);

  if (error) throw error;
}

export { baseClient };
