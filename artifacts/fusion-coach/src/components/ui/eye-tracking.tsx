import { useEffect, useMemo, useRef, useState } from 'react';

type Vec2 = { x: number; y: number };

type EyeTrackingProps = {
  /** Eye diameter in px. */
  eyeSize?: number;
  /** Distance between the two eye centers in px. */
  gap?: number;
  /** Main iris color. */
  irisColor?: string;
  /** Highlight color blended into the top-left of the iris. */
  irisColorSecondary?: string;
  /** Milliseconds between automatic blinks (0 disables blinking). */
  blinkInterval?: number;
  /** Optional sclera (eyeball) color. */
  scleraColor?: string;
  /** Optional ring drawn around each eye. */
  outlineColor?: string;
  /** Eyelid color shown while blinking. */
  lidColor?: string;
  /** Follow the pointer with spring easing. Disable for instant tracking. */
  smooth?: boolean;
  /** Extra class names on the root element. */
  className?: string;
  /** Inline styles on the root element. */
  style?: React.CSSProperties;
};

/** Fraction of the eye size the iris may travel in any direction. */
const MAX_IRIS_TRAVEL = 0.26;
/** Seconds without pointer movement before the eyes start idly wandering. */
const IDLE_AFTER_SECONDS = 2.5;

export function EyeTracking({
  eyeSize = 120,
  gap = 50,
  irisColor = '#202536',
  irisColorSecondary = '#c3df39',
  blinkInterval = 4000,
  scleraColor = '#ffffff',
  outlineColor,
  lidColor = '#f4f0e8',
  smooth = true,
  className,
  style,
}: EyeTrackingProps) {
  const pointerTargetRef = useRef<Vec2>({ x: 0, y: 0 });
  const lastPointerMoveRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [irisOffset, setIrisOffset] = useState<Vec2>({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);

  const eyeRadius = eyeSize / 2;
  const irisSize = eyeSize * 0.46;
  const pupilSize = irisSize * 0.52;
  const highlightSize = irisSize * 0.2;
  const maxTravel = eyeSize * MAX_IRIS_TRAVEL;

  const irisGradientId = useMemo(
    () => `eye-iris-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );

  // Track the pointer across the whole page as a normalized (-1..1) target.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const nx = (event.clientX / window.innerWidth) * 2 - 1;
      const ny = (event.clientY / window.innerHeight) * 2 - 1;
      pointerTargetRef.current = {
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      };
      lastPointerMoveRef.current = performance.now();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  // Spring loop: glide toward the pointer, or wander gently when idle.
  useEffect(() => {
    const current: Vec2 = { x: 0, y: 0 };
    let idleClock = Math.random() * Math.PI * 2;
    let lastTick = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;

      const idle = now - lastPointerMoveRef.current > IDLE_AFTER_SECONDS * 1000;
      let target: Vec2;
      if (idle) {
        // Slow Lissajous drift so the eyes stay alive on touch devices too.
        idleClock += delta * 0.85;
        target = {
          x: Math.sin(idleClock) * 0.45,
          y: Math.sin(idleClock * 0.6 + 1.3) * 0.28,
        };
      } else {
        target = pointerTargetRef.current;
      }

      const eased = smooth ? 1 - Math.exp(-delta * 7.5) : 1;
      current.x += (target.x * maxTravel - current.x) * eased;
      current.y += (target.y * maxTravel - current.y) * eased;
      setIrisOffset({ x: current.x, y: current.y });

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [maxTravel, smooth]);

  // Blink on an interval with a little human jitter.
  useEffect(() => {
    if (blinkInterval <= 0) return;
    let closeTimer: number | null = null;
    let timeoutId: number | null = null;

    const scheduleBlink = () => {
      timeoutId = window.setTimeout(() => {
        setBlinking(true);
        closeTimer = window.setTimeout(() => setBlinking(false), 140);
        scheduleBlink();
      }, blinkInterval + Math.random() * 900);
    };
    scheduleBlink();

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [blinkInterval]);

  const lidHeight = blinking ? eyeSize : 0;

  const renderEye = (key: string) => (
    <div
      key={key}
      style={{
        width: eyeSize,
        height: eyeSize,
        background: scleraColor,
        borderRadius: '50%',
        position: 'relative',
        overflow: 'hidden',
        flex: 'none',
        boxShadow: outlineColor
          ? `0 0 0 2px ${outlineColor}, 0 18px 40px rgba(32,37,54,.18)`
          : '0 18px 40px rgba(32,37,54,.18)',
      }}
    >
      <svg
        width={eyeSize}
        height={eyeSize}
        viewBox={`0 0 ${eyeSize} ${eyeSize}`}
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${irisGradientId}-${key}`} cx="38%" cy="34%" r="78%">
            <stop offset="0%" stopColor={irisColorSecondary} />
            <stop offset="55%" stopColor={irisColor} />
            <stop offset="100%" stopColor={irisColor} />
          </radialGradient>
        </defs>
        <circle
          cx={eyeRadius + irisOffset.x}
          cy={eyeRadius + irisOffset.y}
          r={irisSize / 2}
          fill={`url(#${irisGradientId}-${key})`}
        />
        <circle
          cx={eyeRadius + irisOffset.x}
          cy={eyeRadius + irisOffset.y}
          r={pupilSize / 2}
          fill="#14161f"
        />
        <circle
          cx={eyeRadius + irisOffset.x - irisSize * 0.14}
          cy={eyeRadius + irisOffset.y - irisSize * 0.16}
          r={highlightSize / 2}
          fill="rgba(255,255,255,.85)"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: lidHeight,
          background: lidColor,
          transition: 'height .08s ease',
          borderRadius: '0 0 50% 50% / 0 0 18% 18%',
        }}
      />
    </div>
  );

  return (
    <div
      className={className ? `eye-tracking ${className}` : 'eye-tracking'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        ...style,
      }}
      aria-hidden="true"
    >
      {renderEye('left')}
      {renderEye('right')}
    </div>
  );
}

export default EyeTracking;
