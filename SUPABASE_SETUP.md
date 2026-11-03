# Supabase per-user setup — EchoLabs

Every signed-in user gets their own Supabase client bound to their Clerk JWT.
Row-level security (RLS) then guarantees users can only see their own sessions.

## 1. Create a Supabase project

1. Go to https://supabase.com and sign up / sign in.
2. Click **New Project**.
3. Pick a name (e.g. `echolabs`), set a database password, and choose a region close to your users.
4. Wait for the project to be ready (usually under a minute).

## 2. Note your credentials

From the project dashboard:

- **Project URL** → `https://<project-id>.supabase.co`
- **Anon (public) key** → `Settings → API → anon public`

## 3. Configure the app

Copy `.env.example` to `.env`:

```bash
cd artifacts/fusion-coach
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Do **not** commit `.env`.  The real Supabase URL and key stay on your machine.

Restart the dev server after changing `.env`:

```bash
cd artifacts/fusion-coach
npx vite --config vite.config.ts --host 0.0.0.0 --port 5174
```

## 4. Create the `sessions` table with RLS

Open the Supabase SQL editor (`Project → SQL Editor → New query`) and run:

```sql
-- Enable the uuid extension for id generation
create extension if not exists "uuid-ossp";

-- Per-user sessions table
create table if not exists sessions (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        not null,
  score       numeric(4,2) null,
  status      text        not null default 'in_progress',
  date        timestamptz not null default now(),
  transcript  text        null,
  duration_sec integer    null,
  camera_id   text        null,
  mic_id      text        null,
  mistakes    jsonb       null
);

-- Every user can only see / insert / update their own rows
alter table sessions enable row level security;

create policy "users manage their own sessions"
  on sessions
  for all
  using ( auth.jwt() ->> 'sub' = user_id::text );

-- Optional: speed up history queries
create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_date_idx on sessions(date desc);
```

This policy reads the `sub` claim from the Clerk JWT we pass as the access
token.  If the JWT doesn't match the row's `user_id`, the row is invisible.

## 5. Verify the flow

1. Sign up or sign in on the app.
2. Start a session, speak for at least a few seconds, then end it.
3. Open the Supabase table editor and confirm a row appeared with your
   `user_id` equal to your Clerk user ID.
4. Sign in as a different user (or use the browser's private window) — that
   user should only see their own rows, never yours.

## 6. Troubleshooting

### "Failed to fetch" / "supabase not configured"

- Make sure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in
  `.env` and the dev server was restarted.
- Check the browser console for the actual error.

### RLS denies my queries

- Confirm the `sessions` table exists and RLS is enabled.
- Check that the `user_id` in inserted rows matches your Clerk user ID.
- Verify the JWT is being passed: in the browser console run
  `localStorage.getItem('supabase.auth.token')` after signing in — it should
  contain a JWT whose `sub` claim matches your Clerk user ID.

### Clerk JWT not reaching Supabase

- The `getAuthenticatedClient` helper calls `user.getToken()`.  If that
  returns `null`, the app falls back to the anon client and RLS will deny
  access.  Make sure you're signed in before trying to read/write sessions.

## 7. Extending with more tables

For any new table that should be per-user:

1. Add a `user_id` column (uuid, not null).
2. Enable RLS: `alter table <name> enable row level security;`
3. Add a matching policy:
   ```sql
   create policy "users manage their own <name>"
     on <name>
     for all
     using ( auth.jwt() ->> 'sub' = user_id::text );
   ```
4. Use the same `userClient` from `src/App.tsx` to query the table; the
   client already carries the user's JWT.
