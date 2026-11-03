import { useState } from "react";
import ContentRadar, { type ScoreDimension } from "@/components/content-radar";
import ScoreCard from "@/components/score-card";
import { DEBATE_MOTIONS, INTERVIEW_QUESTIONS } from "@/data/practice-questions";

type AnalysisMode = "general" | "interview" | "debate";
type ContentAnalysis = {
  status: "available" | "partial" | "unavailable";
  scores: Record<string, number | null>;
  grammar_mistakes: Array<{ quote: string; correction: string; explanation: string }>;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  error?: string;
};
type SpeechMetrics = Record<string, unknown>;
type Props = {
  initialTranscript?: string;
  initialMode?: AnalysisMode;
  initialPrompt?: string;
};

const scoreLabels: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  structure: "Structure",
  relevance: "Prompt relevance",
};

export default function ContentResults({ initialTranscript = "", initialMode = "general", initialPrompt = "" }: Props) {
  const [mode, setMode] = useState<AnalysisMode>(initialMode);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [content, setContent] = useState<ContentAnalysis | null>(null);
  const [metrics, setMetrics] = useState<SpeechMetrics | null>(null);
  const [lastEdited, setLastEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rescore = async () => {
    if (!transcript.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const transcriptChanged = transcript.trim() !== (initialTranscript.trim());
      const [contentResponse, metricsResponse] = await Promise.all([
        fetch("/api/analyze/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, prompt_text: prompt, mode }),
        }),
        fetch("/api/analyze/metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, duration_sec: undefined }),
        }),
      ]);
      const [contentPayload, metricPayload] = await Promise.all([
        contentResponse.json(),
        metricsResponse.json(),
      ]);
      if (!contentResponse.ok || !metricsResponse.ok) {
        throw new Error(contentPayload.message ?? metricPayload.message ?? "The transcript could not be re-scored.");
      }
      setContent(contentPayload.content_analysis);
      setMetrics(metricPayload.metrics);
      setLastEdited(transcriptChanged);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transcript scoring failed.");
    } finally {
      setBusy(false);
    }
  };

  const dimensions: ScoreDimension[] = content
    ? Object.entries(content.scores).map(([key, score]) => ({ key, label: scoreLabels[key] ?? key, score }))
    : [];
  const questions = mode === "interview" ? INTERVIEW_QUESTIONS : [];

  return (
    <section className="fc-workspace-view" aria-labelledby="content-results-title">
      <div className="fc-page-heading">
        <div>
          <div className="fc-kicker">Workspace / transcript review</div>
          <h1 id="content-results-title">Transcript &amp; content review</h1>
          <p>Correct the words, then re-run text scoring and transcript-derived metrics. Audio-only metrics remain unchanged.</p>
        </div>
      </div>

      <div className="fc-card fc-lab fc-content-input">
        <div className="fc-content-controls">
          <label>Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as AnalysisMode)}>
              <option value="general">General</option>
              <option value="interview">Interview</option>
              <option value="debate">Debate</option>
            </select>
          </label>
          <label>Prompt or topic
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What question or topic were you answering?" />
          </label>
        </div>
        {mode === "interview" && (
          <label className="fc-content-prompt-picker">Choose an interview question
            <select value={prompt} onChange={(event) => setPrompt(event.target.value)}>
              <option value="">Choose a question</option>
              {questions.map((item) => <option key={item.id} value={item.prompt}>{item.prompt}</option>)}
            </select>
          </label>
        )}
        {mode === "debate" && (
          <label className="fc-content-prompt-picker">Choose a debate motion
            <select value={prompt} onChange={(event) => setPrompt(event.target.value)}>
              <option value="">Choose a motion</option>
              {DEBATE_MOTIONS.map((motion) => <option key={motion} value={motion}>{motion}</option>)}
            </select>
          </label>
        )}
        <label className="fc-content-transcript-label" htmlFor="content-transcript">Editable transcript</label>
        <textarea id="content-transcript" className="fc-lab-transcript" rows={8} value={transcript} onChange={(event) => setTranscript(event.target.value)} />
        <div className="fc-lab-controls">
          <button className="fc-lab-primary" disabled={busy || !transcript.trim()} onClick={() => void rescore()}>
            {busy ? "Scoring transcript…" : "Re-score transcript"}
          </button>
        </div>
        {error && <p className="fc-lab-error" role="alert">{error}</p>}
      </div>

      {content && (
        <div className="fc-content-results" data-testid="content-results">
          <section className="fc-card fc-lab">
            <div className="fc-card-head">
              <div><h3 className="fc-card-title">Content scores</h3><span className="fc-card-meta">Text evidence only · score scale 0–10 · {content.status}</span></div>
            </div>
            {content.status === "unavailable" && <p className="fc-lab-error" role="status">{content.error ?? "Content scoring is unavailable."} Deterministic metrics remain available.</p>}
            <div className="fc-content-score-grid">
              {dimensions.map((dimension) => <ScoreCard key={dimension.key} label={dimension.label} score={dimension.score} />)}
            </div>
            <ContentRadar dimensions={dimensions} />
          </section>

          {metrics && (
            <section className="fc-card fc-lab">
              <div className="fc-card-head"><div><h3 className="fc-card-title">Transcript-derived metrics</h3><span className="fc-card-meta">{lastEdited ? "Recomputed for the edited text; timings are unavailable because they no longer align." : "Recomputed from transcript; upload audio to measure pace and word timings."}</span></div></div>
              <pre className="fc-content-metrics">{JSON.stringify(metrics, null, 2)}</pre>
            </section>
          )}

          {content.grammar_mistakes.length > 0 && (
            <section className="fc-card fc-lab">
              <div className="fc-card-head"><div><h3 className="fc-card-title">Quoted grammar corrections</h3></div></div>
              <ul className="fc-content-list">{content.grammar_mistakes.map((mistake, index) => <li key={`${mistake.quote}-${index}`}><b>“{mistake.quote}” → “{mistake.correction}”</b><span>{mistake.explanation}</span></li>)}</ul>
            </section>
          )}
          {(["strengths", "weaknesses", "suggestions"] as const).map((key) => (
            <section className="fc-card fc-lab" key={key}>
              <div className="fc-card-head"><div><h3 className="fc-card-title">{key === "suggestions" ? "Next steps" : key[0].toUpperCase() + key.slice(1)}</h3></div></div>
              {content[key].length ? <ul className="fc-content-list">{content[key].map((item, index) => <li key={`${key}-${index}`}>{item}</li>)}</ul> : <p className="fc-lab-hint">No supported items returned.</p>}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
