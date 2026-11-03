export type SessionForCalibration = {
  session_id: string;
  metrics?: any;
  acoustic_features?: any;
  video_metrics?: any;
  unified_scores?: any;
  scores?: any;
};

export function exportSessionsCSV(sessions: SessionForCalibration[], humanRatings?: Record<string, Record<string, number>>): string {
  const headers = ["session_id", "wpm", "fillers", "pauses", "fluency_score", "unified_total", "human_overall"];
  const rows = [headers.join(",")];
  for (const s of sessions) {
    const wpm = s.metrics?.wpm ?? "";
    const fillers = s.metrics?.fillers?.scored ?? "";
    const pauses = s.metrics?.pauses?.count ?? "";
    const fluency = s.unified_scores?.breakdown?.fluency ?? "";
    const total = s.unified_scores?.total ?? "";
    const humanOverall = humanRatings?.[s.session_id]?.overall ?? "";
    rows.push([s.session_id, wpm, fillers, pauses, fluency, total, humanOverall].join(","));
  }
  return rows.join("\n");
}

export function computeCorrelations(sessions: SessionForCalibration[], humanRatings: Record<string, Record<string, number>>): Record<string, number> {
  const correlations: Record<string, number> = {};
  const features = ["wpm", "fillers", "pauses", "fluency"];
  for (const feat of features) {
    const pairs: Array<[number, number]> = [];
    for (const s of sessions) {
      const human = humanRatings[s.session_id]?.overall;
      if (typeof human !== "number") continue;
      let val: number | undefined;
      if (feat === "wpm") val = s.metrics?.wpm;
      if (feat === "fillers") val = s.metrics?.fillers?.scored;
      if (feat === "pauses") val = s.metrics?.pauses?.count;
      if (feat === "fluency") val = s.unified_scores?.breakdown?.fluency;
      if (typeof val === "number") pairs.push([val, human]);
    }
    if (pairs.length < 2) {
      correlations[feat] = NaN;
      continue;
    }
    const meanX = pairs.reduce((a,b)=>a+b[0],0)/pairs.length;
    const meanY = pairs.reduce((a,b)=>a+b[1],0)/pairs.length;
    let num = 0, denX = 0, denY = 0;
    for (const [x,y] of pairs) {
      num += (x-meanX)*(y-meanY);
      denX += (x-meanX)**2;
      denY += (y-meanY)**2;
    }
    correlations[feat] = denX>0 && denY>0 ? num/Math.sqrt(denX*denY) : 0;
  }
  return correlations;
}
