export type SessionRecord = {
  created_at: string | Date;
  scores?: Record<string, number | null> | null;
  unified_scores?: { total?: number | null } | null;
};

export function calculateStreak(sessions: SessionRecord[]): number {
  if (sessions.length === 0) return 0;
  const dates = sessions
    .map((s) => {
      const d = new Date(s.created_at);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    })
    .sort((a, b) => b - a);
  const unique = Array.from(new Set(dates));
  let streak = 1;
  for (let i = 1; i < unique.length; i++) {
    const diff = (unique[i - 1] - unique[i]) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      streak++;
    } else if (diff > 1) {
      break;
    }
  }
  return streak;
}

export function weekOverWeekChange(sessions: SessionRecord[]): { current_week_avg: number | null; previous_week_avg: number | null; change_pct: number | null } {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  const getScore = (s: SessionRecord): number | null => {
    if (s.unified_scores?.total !== null && s.unified_scores?.total !== undefined) return s.unified_scores.total;
    if (s.scores) {
      const vals = Object.values(s.scores).filter((v): v is number => typeof v === "number");
      if (vals.length > 0) return (vals.reduce((a,b)=>a+b,0)/vals.length)*10;
    }
    return null;
  };
  
  const current = sessions.filter((s) => new Date(s.created_at) >= weekAgo).map(getScore).filter((v): v is number => v !== null);
  const previous = sessions.filter((s) => {
    const d = new Date(s.created_at);
    return d >= twoWeeksAgo && d < weekAgo;
  }).map(getScore).filter((v): v is number => v !== null);
  
  const currentAvg = current.length > 0 ? current.reduce((a,b)=>a+b,0)/current.length : null;
  const previousAvg = previous.length > 0 ? previous.reduce((a,b)=>a+b,0)/previous.length : null;
  let changePct: number | null = null;
  if (currentAvg !== null && previousAvg !== null && previousAvg !== 0) {
    changePct = ((currentAvg - previousAvg) / previousAvg) * 100;
  }
  return { current_week_avg: currentAvg, previous_week_avg: previousAvg, change_pct: changePct };
}

export function getProgressSummary(sessions: SessionRecord[]) {
  const streak = calculateStreak(sessions);
  const wow = weekOverWeekChange(sessions);
  return {
    streak_days: streak,
    week_over_week: wow,
    total_sessions: sessions.length,
  };
}
