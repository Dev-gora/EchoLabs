type ScoreCardProps = {
  label: string;
  score: number | null;
  explanation?: string;
};

export default function ScoreCard({ label, score, explanation }: ScoreCardProps) {
  const measured = score !== null && Number.isFinite(score);
  const percent = measured ? Math.round((score / 10) * 100) : 0;
  return (
    <article className="fc-card fc-content-score" aria-label={`${label}: ${measured ? `${score} out of 10` : "not available"}`}>
      <span>{label}</span>
      <strong>{measured ? `${score}/10` : "—"}</strong>
      <div className="fc-content-score-track" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
      {explanation && <small>{explanation}</small>}
    </article>
  );
}
