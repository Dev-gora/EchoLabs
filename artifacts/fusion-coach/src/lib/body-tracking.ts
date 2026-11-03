/**
 * Body/hand tracking utilities inspired by Presentation-Scoring ideas.
 * Add smoothing and window aggregation only if they improve stability.
 */

export type Point2D = { x: number; y: number };
export type Point3D = { x: number; y: number; z?: number; visibility?: number };

export class LandmarkKalmanFilter {
  // Simple 2D Kalman filter for (x,y)
  x: number[]; // [x, y, vx, vy]
  P: number[][]; // covariance
  A: number[][]; // state transition
  H: number[][]; // measurement
  Q: number[][]; // process noise
  R: number[][]; // measurement noise

  constructor(initialX = 0, initialY = 0) {
    this.x = [initialX, initialY, 0, 0];
    this.P = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const dt = 1 / 30; // assume ~30fps
    this.A = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    this.H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    this.Q = [
      [0.001, 0, 0, 0],
      [0, 0.001, 0, 0],
      [0, 0, 0.01, 0],
      [0, 0, 0, 0.01],
    ];
    this.R = [
      [0.01, 0],
      [0, 0.01],
    ];
  }

  predict(): void {
    // x = A*x
    this.x = [
      this.A[0][0] * this.x[0] + this.A[0][1] * this.x[1] + this.A[0][2] * this.x[2] + this.A[0][3] * this.x[3],
      this.A[1][0] * this.x[0] + this.A[1][1] * this.x[1] + this.A[1][2] * this.x[2] + this.A[1][3] * this.x[3],
      this.A[2][0] * this.x[0] + this.A[2][1] * this.x[1] + this.A[2][2] * this.x[2] + this.A[2][3] * this.x[3],
      this.A[3][0] * this.x[0] + this.A[3][1] * this.x[1] + this.A[3][2] * this.x[2] + this.A[3][3] * this.x[3],
    ];
    // P = A*P*A^T + Q
    const P = this.P;
    const A = this.A;
    // simplified
    const AP = [
      [A[0][0]*P[0][0]+A[0][2]*P[2][0], A[0][0]*P[0][1]+A[0][2]*P[2][1], A[0][0]*P[0][2]+A[0][2]*P[2][2], A[0][0]*P[0][3]+A[0][2]*P[2][3]],
      [A[1][1]*P[1][0]+A[1][3]*P[3][0], A[1][1]*P[1][1]+A[1][3]*P[3][1], A[1][1]*P[1][2]+A[1][3]*P[3][2], A[1][1]*P[1][3]+A[1][3]*P[3][3]],
      [A[2][2]*P[2][0], A[2][2]*P[2][1], A[2][2]*P[2][2], A[2][2]*P[2][3]],
      [A[3][3]*P[3][0], A[3][3]*P[3][1], A[3][3]*P[3][2], A[3][3]*P[3][3]],
    ];
    this.P = [
      [AP[0][0]+this.Q[0][0], AP[0][1], AP[0][2], AP[0][3]],
      [AP[1][0], AP[1][1]+this.Q[1][1], AP[1][2], AP[1][3]],
      [AP[2][0], AP[2][1], AP[2][2]+this.Q[2][2], AP[2][3]],
      [AP[3][0], AP[3][1], AP[3][2], AP[3][3]+this.Q[3][3]],
    ];
  }

  update(measX: number, measY: number): Point2D {
    this.predict();
    // Kalman gain simplified
    const Kx = this.P[0][0] / (this.P[0][0] + this.R[0][0]);
    const Ky = this.P[1][1] / (this.P[1][1] + this.R[1][1]);
    this.x[0] = this.x[0] + Kx * (measX - this.x[0]);
    this.x[1] = this.x[1] + Ky * (measY - this.x[1]);
    this.x[2] = this.x[2] * 0.9;
    this.x[3] = this.x[3] * 0.9;
    this.P[0][0] = (1 - Kx) * this.P[0][0];
    this.P[1][1] = (1 - Ky) * this.P[1][1];
    return { x: this.x[0], y: this.x[1] };
  }
}

export function smoothLandmarks(landmarks: Point3D[], filters: LandmarkKalmanFilter[]): Point3D[] {
  if (landmarks.length !== filters.length) return landmarks;
  return landmarks.map((lm, i) => {
    const smoothed = filters[i].update(lm.x, lm.y);
    return { ...lm, x: smoothed.x, y: smoothed.y };
  });
}

export function angleBetweenPoints(a: Point2D, b: Point2D, c: Point2D): number {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magCB = Math.sqrt(cbx * cbx + cby * cby);
  if (magAB === 0 || magCB === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export type WindowFlag = { frame: number; flag: boolean };

export function aggregateFlagsIntoWindows(flags: boolean[], windowSize: number): boolean[] {
  if (windowSize <= 1) return flags.slice();
  const result: boolean[] = [];
  for (let i = 0; i < flags.length; i++) {
    let count = 0;
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(flags.length, i + Math.ceil(windowSize / 2));
    for (let j = start; j < end; j++) {
      if (flags[j]) count++;
    }
    result.push(count / (end - start) >= 0.3); // threshold
  }
  return result;
}

export function measureJitter(points: Point2D[]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum / (points.length - 1);
}
