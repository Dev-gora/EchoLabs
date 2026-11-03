import assert from "node:assert/strict";
import { test } from "node:test";
import { LandmarkKalmanFilter, measureJitter, aggregateFlagsIntoWindows } from "../src/lib/body-tracking.ts";

test("kalman smoothing reduces jitter on noisy landmarks", () => {
  const filters = Array.from({ length: 1 }, () => new LandmarkKalmanFilter(0.5, 0.5));
  const noisy: Array<{x:number,y:number}> = [];
  for (let i = 0; i < 30; i++) {
    noisy.push({ x: 0.5 + (Math.random() - 0.5) * 0.05, y: 0.5 + (Math.random() - 0.5) * 0.05 });
  }
  const smoothed: Array<{x:number,y:number}> = [];
  for (let i = 0; i < noisy.length; i++) {
    smoothed.push(filters[0].update(noisy[i].x, noisy[i].y));
  }
  const jitterNoisy = measureJitter(noisy);
  const jitterSmooth = measureJitter(smoothed);
  assert.ok(jitterSmooth < jitterNoisy);
});

test("window aggregation reduces noise in per-frame flags", () => {
  const flags = [false, false, true, false, false, true, false, false, false, false, true, false, false, false, false];
  const windowed = aggregateFlagsIntoWindows(flags, 15);
  // should aggregate spikes
  assert.equal(windowed.length, flags.length);
  assert.ok(windowed.some((v) => v === true));
});
