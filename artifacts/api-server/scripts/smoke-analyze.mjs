const BASE = process.env.BASE ?? "http://127.0.0.1:5057/api";

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const answer =
  "I think the biggest reason I want this role is the scope of the problem. " +
  "You know, I have spent four years building data pipelines, and, um, the part I enjoy most is making them boring. " +
  "Last year we, uh, cut nightly runtime from six hours to forty minutes by rewriting the loader. " +
  "I basically owned that migration from design to rollout, and sort of had to convince three teams to change how they deploy. " +
  "So yes, I would love to bring that same approach here.";

// 1. happy path
const res = await fetch(`${BASE}/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    transcript: answer,
    duration: 52,
    audio_url: "https://example.com/take-1.webm",
    segments: [
      { start: 0, end: 6 },
      { start: 9, end: 18 },
      { start: 18.4, end: 30 },
      { start: 33, end: 44 },
      { start: 44.2, end: 52 },
    ],
  }),
});

const body = await res.json();
check("POST /analyze returns 200", res.status === 200, res.status);
check("session_id is a uuid", /^[0-9a-f-]{36}$/.test(body.session_id ?? ""), body.session_id);
check("word_count equals token count", body.metrics.word_count === 86, body.metrics.word_count);
check(
  "wpm is words over duration",
  body.metrics.wpm === Math.round((86 / 52) * 60 * 10) / 10,
  body.metrics.wpm,
);
check("fillers detected", body.metrics.fillers === 5, body.metrics.fillers);
check("pauses count the two long gaps", body.metrics.pauses === 2, body.metrics.pauses);
check("audio_url echoed", body.audio_url === "https://example.com/take-1.webm", body.audio_url);
check(
  "scores are 1..10 integers",
  ["fluency", "vocabulary", "grammar", "structure"].every(
    (k) => Number.isInteger(body.scores[k]) && body.scores[k] >= 1 && body.scores[k] <= 10,
  ),
  body.scores,
);
check("feedback mentions the transcript-based caveat", body.feedback.some((f) => f.includes("delivery indicators")), body.feedback);

// 2. fetch the stored analysis
const got = await fetch(`${BASE}/analyze/${body.session_id}`);
const gotBody = await got.json();
check("GET /analyze/:id returns 200", got.status === 200, got.status);
check("GET returns the same transcript", gotBody.transcript === body.transcript);
check("GET returns the same scores", JSON.stringify(gotBody.scores) === JSON.stringify(body.scores));

// 3. retry comparison
const better =
  "The scope of the problem is what draws me to this role. " +
  "I have spent four years building data pipelines, and the part I enjoy most is making them boring. " +
  "Last year I cut nightly runtime from six hours to forty minutes by rewriting the loader. " +
  "I owned that migration from design to rollout, and I convinced three teams to change how they deploy. " +
  "I would like to bring that same approach here.";

const retry = await fetch(`${BASE}/analyze/retry`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ session_id: body.session_id, transcript: better, duration: 40 }),
});
const retryBody = await retry.json();
check("POST /analyze/retry returns 200", retry.status === 200, retry.status);
check("retry has a comparison", Boolean(retryBody.comparison), retryBody.comparison);
check(
  "comparison keeps the original attempt",
  retryBody.comparison?.original_attempt?.wpm === body.metrics.wpm,
  retryBody.comparison?.original_attempt,
);
check(
  "comparison reports fewer fillers",
  retryBody.comparison?.improvements?.fillers === "-5 fillers",
  retryBody.comparison?.improvements,
);
check(
  "'would like' is not counted as a filler",
  retryBody.metrics.fillers === 0,
  retryBody.metrics.fillers,
);
check("retry is stored under a new id", retryBody.session_id && retryBody.session_id !== body.session_id);

// 4. insufficient speech
const short = await fetch(`${BASE}/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ transcript: "Hello there.", duration: 2 }),
});
const shortBody = await short.json();
check("short answer returns 422", short.status === 422, short.status);
check("422 names insufficient_speech", shortBody.error === "insufficient_speech", shortBody);

// 5. bad payload
const bad = await fetch(`${BASE}/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ transcript: answer }),
});
const badBody = await bad.json();
check("missing duration returns 400", bad.status === 400, bad.status);
check(
  "400 lists the offending field",
  badBody.issues?.some((i) => i.path === "duration"),
  badBody.issues,
);

// 6. unknown session
const missing = await fetch(`${BASE}/analyze/does-not-exist`);
check("unknown session returns 404", missing.status === 404, missing.status);

// 7. ideal answer has no provider
const ideal = await fetch(`${BASE}/analyze/ideal`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ transcript: answer, prompt_text: "Why this role?" }),
});
const idealBody = await ideal.json();
check("ideal answer returns 503", ideal.status === 503, ideal.status);
check("503 names llm_unavailable", idealBody.error === "llm_unavailable", idealBody);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
