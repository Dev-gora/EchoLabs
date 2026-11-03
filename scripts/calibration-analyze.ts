#!/usr/bin/env ts-node
import { computeCorrelations, exportSessionsCSV } from "../artifacts/api-server/src/lib/calibration";

// This is a hook/script - run with real data
const sessions: any[] = [];
const humanRatings: Record<string, Record<string, number>> = {};

const correlations = computeCorrelations(sessions, humanRatings);
console.log("Per-metric correlation with human ratings:");
for (const [k, v] of Object.entries(correlations)) {
  console.log(`  ${k}: ${isNaN(v) ? "N/A (insufficient data)" : v.toFixed(3)}`);
}
console.log("\nSuggested threshold changes (weights unvalidated - not auto-applied):");
console.log("  - Review features with |correlation| < 0.3 for possible weight adjustment");
console.log("  - Collect more human ratings before changing thresholds/weights");
console.log("\nCSV export available via exportSessionsCSV()");
