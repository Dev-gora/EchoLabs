import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

export type ScoreDimension = { key: string; label: string; score: number | null };

type ContentRadarProps = { dimensions: ScoreDimension[] };

export default function ContentRadar({ dimensions }: ContentRadarProps) {
  const data = dimensions
    .filter((dimension) => dimension.score !== null && Number.isFinite(dimension.score))
    .map((dimension) => ({ metric: dimension.label, score: dimension.score }));

  if (data.length < 3) {
    return <p className="fc-content-empty">The radar needs at least three measured dimensions.</p>;
  }

  return (
    <div className="fc-content-radar" aria-label="Content score radar chart">
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#e6e0d5" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: "#73777d", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 10]} tick={{ fill: "#92949a", fontSize: 9 }} />
          <Tooltip formatter={(value) => [`${value}/10`, "Score"]} />
          <Radar name="Content score" dataKey="score" stroke="#a45143" fill="#c3df39" fillOpacity={0.32} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
