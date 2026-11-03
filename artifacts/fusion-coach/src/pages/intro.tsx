import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowRight,
  AudioLines,
  Camera,
  ChevronDown,
  Eye,
  Gauge,
  Lightbulb,
  Pause,
  Play,
  ScanFace,
  Smile,
  Waves,
} from 'lucide-react';
import { Link } from 'wouter';
import { EyeTracking } from '@/components/ui/eye-tracking';

const DEMO_VIDEO_URL = `${import.meta.env.BASE_URL}demo/confidence-demo.mp4`;

const marqueeItems = [
  'Eye contact',
  'Speech confidence',
  'Facial expression',
  'Posture',
  'Filler words',
  'Pace & pauses',
];

const confidenceNotes = [
  {
    icon: Eye,
    title: 'Hold the room with your eyes',
    body: 'Aim for the camera, not your own preview. Eye contact reads as trust — steady, not staring. Land a thought, breathe, look again.',
    tag: 'Look',
  },
  {
    icon: AudioLines,
    title: 'Let your voice carry weight',
    body: 'Slow down ten percent. End sentences on a full stop instead of letting them drift up. Silence between ideas sounds like conviction.',
    tag: 'Sound',
  },
  {
    icon: Smile,
    title: 'Move like you mean it',
    body: 'Open posture, unhurried gestures, one genuine smile. Your face should agree with your words before your words arrive.',
    tag: 'Presence',
  },
  {
    icon: Waves,
    title: 'Trade fillers for pauses',
    body: '“Um” and “like” are breath looking for a job. Replace them with a beat of quiet and your next point lands twice as hard.',
    tag: 'Clarity',
  },
];

const whyItMatters = [
  {
    stat: '93%',
    body: 'of first impressions form before a full sentence lands. Presence speaks first.',
  },
  {
    stat: '2×',
    body: 'Speakers with steady eye contact are trusted roughly twice as much in interviews.',
  },
  {
    stat: '7s',
    body: 'is all it takes for an audience to decide whether you own the room — or not.',
  },
];

const howItWorks = [
  {
    step: '01',
    icon: Camera,
    title: 'Capture',
    body: 'Your camera, microphone, face, and posture stream straight into the engine inside your browser. Only the finished transcript is sent for the delivery read.',
  },
  {
    step: '02',
    icon: ScanFace,
    title: 'Analyze',
    body: 'EchoLabs reads eye contact, expression, voice energy, and stance as one fused signal, in real time.',
  },
  {
    step: '03',
    icon: Gauge,
    title: 'Score',
    body: 'A single honest readout — evidence-based, never vibes-based. Silence never earns a default score.',
  },
  {
    step: '04',
    icon: Lightbulb,
    title: 'Improve',
    body: 'One specific, coachable note per session. Review the tape, fix one thing, run it back.',
  },
];

const css = `
.in-root {
  min-height: 100vh;
  background: #12151f;
  color: #f4f0e8;
  font-family: var(--app-font-sans, sans-serif);
  overflow-x: hidden;
  position: relative;
}
.in-spot {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(520px circle at var(--mx, 70%) var(--my, 12%), rgba(195, 223, 57, 0.13), transparent 65%),
    radial-gradient(760px circle at var(--mx, 70%) var(--my, 12%), rgba(239, 128, 109, 0.07), transparent 70%);
  transition: background 0.25s ease;
}
.in-shell { position: relative; z-index: 1; }

/* nav */
.in-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px clamp(20px, 5vw, 56px);
  background: rgba(18, 21, 31, 0.82);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.in-brand { display: flex; align-items: center; gap: 11px; }
.in-brand-mark {
  width: 32px; height: 32px;
  border-radius: 10px 10px 10px 3px;
  background: #c3df39; color: #202536;
  display: grid; place-items: center;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700; font-size: 16px;
  transform: rotate(-7deg);
}
.in-brand-name {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700; font-size: 19px;
  letter-spacing: -0.04em;
}
.in-brand-name b { color: #c3df39; font-weight: 700; }
.in-nav-cta {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid rgba(195, 223, 57, 0.45);
  background: rgba(195, 223, 57, 0.12);
  color: #e6f39a;
  padding: 10px 16px;
  border-radius: 11px;
  font-size: 12px; font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.2s ease, transform 0.2s ease;
}
.in-nav-cta:hover { background: rgba(195, 223, 57, 0.22); transform: translateY(-1px); }

/* hero */
.in-hero {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: clamp(24px, 4vw, 56px);
  align-items: center;
  padding: clamp(40px, 7vh, 84px) clamp(20px, 5vw, 56px) clamp(36px, 6vh, 64px);
  max-width: 1280px;
  margin: 0 auto;
}
.in-kicker {
  display: inline-flex; align-items: center; gap: 8px;
  color: #c3df39;
  font: 500 10px var(--app-font-mono, monospace);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 8px 12px;
  border: 1px solid rgba(195, 223, 57, 0.3);
  border-radius: 999px;
  background: rgba(195, 223, 57, 0.08);
  width: fit-content;
}
.in-kicker i {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ef806d;
  animation: in-pulse 1.8s ease-in-out infinite;
}
.in-hero h1 {
  margin: 22px 0 18px;
  font: 600 clamp(34px, 4.6vw, 58px)/1.04 'Space Grotesk', sans-serif;
  letter-spacing: -0.05em;
}
.in-hero h1 em {
  font-style: normal;
  color: #c3df39;
}
.in-hero .in-sub {
  margin: 0 0 30px;
  max-width: 480px;
  color: #a9adba;
  font-size: 15px;
  line-height: 1.7;
}
.in-ctas { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.in-cta-primary {
  display: inline-flex; align-items: center; gap: 10px;
  background: #c3df39; color: #202536;
  border: 0; border-radius: 13px;
  padding: 15px 22px;
  font: 800 13px var(--app-font-sans, sans-serif);
  cursor: pointer;
  text-decoration: none;
  transition: transform 0.2s ease, filter 0.2s ease;
}
.in-cta-primary:hover { transform: translateY(-2px); filter: brightness(1.05); }
.in-cta-ghost {
  display: inline-flex; align-items: center; gap: 8px;
  color: #a9adba; font-size: 12px; font-weight: 600;
  border: 0; background: transparent; cursor: pointer;
  text-decoration: none;
  padding: 12px 6px;
}
.in-cta-ghost:hover { color: #f4f0e8; }
.in-hero-note {
  margin-top: 26px;
  display: flex; align-items: center; gap: 8px;
  color: #6d7280;
  font: 10px var(--app-font-mono, monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* video card */
.in-video-stage { perspective: 1100px; }
.in-video-card {
  position: relative;
  border-radius: 22px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1b2030;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(195, 223, 57, 0.08);
  transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  transition: transform 0.25s ease;
  transform-style: preserve-3d;
}
.in-video-card video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}
.in-video-chip {
  position: absolute; top: 14px; left: 14px;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 11px;
  border-radius: 8px;
  background: rgba(18, 21, 31, 0.78);
  color: #c3df39;
  font: 500 9px var(--app-font-mono, monospace);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.in-video-replay {
  position: absolute; bottom: 14px; right: 14px;
  width: 38px; height: 38px;
  display: grid; place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: rgba(18, 21, 31, 0.7);
  color: #f4f0e8;
  cursor: pointer;
  transition: background 0.2s ease;
}
.in-video-replay:hover { background: rgba(195, 223, 57, 0.25); color: #e6f39a; }
.in-video-scanline {
  position: absolute; inset: 0;
  pointer-events: none;
  background: linear-gradient(rgba(195, 223, 57, 0.05) 1px, transparent 1px);
  background-size: 100% 3px;
  opacity: 0.35;
}

/* marquee */
.in-marquee {
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  overflow: hidden;
  padding: 16px 0;
  background: rgba(255, 255, 255, 0.02);
}
.in-marquee-track {
  display: flex; gap: 48px;
  width: max-content;
  animation: in-marquee 26s linear infinite;
}
.in-marquee-item {
  display: inline-flex; align-items: center; gap: 48px;
  color: #8d92a1;
  font: 500 11px var(--app-font-mono, monospace);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  white-space: nowrap;
}
.in-marquee-item:after {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: #c3df39;
  opacity: 0.6;
}

/* eyes band */
.in-eyes-band {
  padding: clamp(48px, 8vh, 88px) 24px;
  display: grid;
  justify-items: center;
  gap: 28px;
  text-align: center;
}
.in-eyes-copy {
  max-width: 620px;
  color: #a9adba;
  font-size: 14px;
  line-height: 1.75;
  margin: 0;
}
.in-eyes-copy b { color: #f4f0e8; }
.in-eyes-hint {
  color: #6d7280;
  font: 10px var(--app-font-mono, monospace);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 8px;
}

/* section scaffolding */
.in-section {
  max-width: 1180px;
  margin: 0 auto;
  padding: clamp(48px, 8vh, 92px) clamp(20px, 5vw, 56px);
}
.in-section-head { max-width: 640px; margin-bottom: 40px; }
.in-section-eyebrow {
  color: #ef806d;
  font: 500 10px var(--app-font-mono, monospace);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.in-section h2 {
  margin: 12px 0 12px;
  font: 600 clamp(26px, 3.2vw, 40px)/1.1 'Space Grotesk', sans-serif;
  letter-spacing: -0.045em;
}
.in-section-head p { margin: 0; color: #a9adba; font-size: 14px; line-height: 1.7; }

/* confidence notes */
.in-notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.in-note {
  position: relative;
  padding: 26px 26px 24px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  transition: transform 0.25s ease, border-color 0.25s ease, background 0.25s ease;
  overflow: hidden;
}
.in-note:hover { transform: translateY(-4px); border-color: rgba(195, 223, 57, 0.4); background: rgba(195, 223, 57, 0.05); }
.in-note-icon {
  width: 40px; height: 40px;
  display: grid; place-items: center;
  border-radius: 12px;
  background: rgba(195, 223, 57, 0.14);
  color: #c3df39;
  margin-bottom: 18px;
}
.in-note h3 { margin: 0 0 8px; font: 600 17px 'Space Grotesk', sans-serif; letter-spacing: -0.03em; }
.in-note p { margin: 0; color: #a9adba; font-size: 13px; line-height: 1.7; }
.in-note-tag {
  position: absolute; top: 20px; right: 20px;
  padding: 5px 9px;
  border-radius: 6px;
  border: 1px solid rgba(239, 128, 109, 0.35);
  color: #ef806d;
  font: 9px var(--app-font-mono, monospace);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

/* why it matters */
.in-why { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.in-why-card {
  padding: 28px 26px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}
.in-why-card b {
  display: block;
  font: 700 clamp(34px, 3.4vw, 46px)/1 'Space Grotesk', sans-serif;
  letter-spacing: -0.05em;
  color: #c3df39;
  margin-bottom: 14px;
}
.in-why-card span { color: #a9adba; font-size: 13px; line-height: 1.65; }
.in-why-quote {
  margin: 34px auto 0;
  max-width: 760px;
  text-align: center;
  color: #d9d5c9;
  font: 500 clamp(17px, 2vw, 22px)/1.55 'Space Grotesk', sans-serif;
  letter-spacing: -0.02em;
}
.in-why-quote em { font-style: normal; color: #ef806d; }

/* how it works */
.in-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.in-step {
  position: relative;
  padding: 24px 22px 26px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  transition: transform 0.25s ease, border-color 0.25s ease;
}
.in-step:hover { transform: translateY(-4px); border-color: rgba(239, 128, 109, 0.45); }
.in-step-num {
  position: absolute; top: 20px; right: 20px;
  font: 500 11px var(--app-font-mono, monospace);
  color: #6d7280;
}
.in-step-icon {
  width: 40px; height: 40px;
  display: grid; place-items: center;
  border-radius: 12px;
  background: rgba(239, 128, 109, 0.14);
  color: #ef806d;
  margin-bottom: 18px;
}
.in-step h3 { margin: 0 0 8px; font: 600 16px 'Space Grotesk', sans-serif; letter-spacing: -0.03em; }
.in-step p { margin: 0; color: #a9adba; font-size: 12.5px; line-height: 1.65; }

/* final CTA */
.in-final {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 clamp(20px, 5vw, 56px) clamp(60px, 10vh, 110px);
}
.in-final-card {
  position: relative;
  overflow: hidden;
  border-radius: 26px;
  border: 1px solid rgba(195, 223, 57, 0.35);
  background: linear-gradient(135deg, rgba(195, 223, 57, 0.14), rgba(239, 128, 109, 0.08) 55%, rgba(255, 255, 255, 0.03));
  padding: clamp(40px, 6vw, 72px);
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 18px;
}
.in-final-card h2 {
  margin: 0;
  font: 600 clamp(28px, 3.6vw, 44px)/1.08 'Space Grotesk', sans-serif;
  letter-spacing: -0.05em;
  max-width: 640px;
}
.in-final-card p { margin: 0; max-width: 480px; color: #b6bac4; font-size: 14px; line-height: 1.7; }
.in-final-card .in-cta-primary { margin-top: 8px; }
.in-final-eyes { margin-bottom: 4px; }

.in-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 26px clamp(20px, 5vw, 56px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  color: #6d7280;
  font: 10px var(--app-font-mono, monospace);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

@keyframes in-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes in-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@media (max-width: 960px) {
  .in-hero { grid-template-columns: 1fr; }
  .in-notes { grid-template-columns: 1fr; }
  .in-why { grid-template-columns: 1fr; }
  .in-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .in-steps { grid-template-columns: 1fr; }
  .in-nav-cta span { display: none; }
}
`;

export default function Intro() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [playing, setPlaying] = useState(true);

  // Cursor spotlight for the whole page.
  useEffect(() => {
    const root = document.documentElement;
    const onMove = (event: PointerEvent) => {
      root.style.setProperty('--mx', `${(event.clientX / window.innerWidth) * 100}%`);
      root.style.setProperty('--my', `${(event.clientY / window.innerHeight) * 100}%`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const handleHeroPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: -ny * 6, y: nx * 8 });
  };

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const replayVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
    setPlaying(true);
  };

  return (
    <div className="in-root">
      <style>{css}</style>
      <div className="in-spot" aria-hidden="true" />

      <nav className="in-nav">
        <div className="in-brand">
          <div className="in-brand-mark">F</div>
          <div className="in-brand-name">EchoLabs<b>.</b></div>
        </div>
        <Link href="/app" className="in-nav-cta" data-testid="intro-nav-enter">
          Enter practice room <ArrowRight size={14} />
        </Link>
      </nav>

      <div className="in-shell">
        <header className="in-hero">
          <div>
            <span className="in-kicker"><i /> EchoLabs — confidence engine</span>
            <h1>Own the moment <em>before</em> you say a word.</h1>
            <p className="in-sub">
              EchoLabs watches the way you look and the way you sound — eye contact,
              expression, posture, voice — and turns it into one honest readout you can
              actually train. Private, in-browser, and judged by evidence, not vibes.
            </p>
            <div className="in-ctas">
              <Link href="/app" className="in-cta-primary" data-testid="intro-cta-start">
                Start practicing <ArrowRight size={15} />
              </Link>
              <a href="#how" className="in-cta-ghost">
                See how it works <ChevronDown size={14} />
              </a>
            </div>
            <div className="in-hero-note">
              <Camera size={13} /> Camera &amp; mic stay on this device — only the final transcript is sent for scoring
            </div>
          </div>

          <div className="in-video-stage" onPointerMove={handleHeroPointerMove} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
            <div
              className="in-video-card"
              style={{ '--tilt-x': `${tilt.x}deg`, '--tilt-y': `${tilt.y}deg` } as CSSProperties}
            >
              <video
                ref={videoRef}
                src={DEMO_VIDEO_URL}
                autoPlay
                muted
                loop
                playsInline
                aria-label="EchoLabs live assessment demo"
              />
              <div className="in-video-scanline" aria-hidden="true" />
              <span className="in-video-chip">
                <ScanFace size={12} /> Live assessment — demo run
              </span>
              <button
                type="button"
                className="in-video-replay"
                onClick={toggleVideo}
                aria-label={playing ? 'Pause demo video' : 'Play demo video'}
                data-testid="intro-video-toggle"
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
            </div>
          </div>
        </header>

        <div className="in-marquee" aria-hidden="true">
          <div className="in-marquee-track">
            {[0, 1].map((copy) => (
              <div className="in-marquee-item" key={copy}>
                {marqueeItems.map((item) => <span key={`${copy}-${item}`}>{item}</span>)}
              </div>
            ))}
          </div>
        </div>

        <section className="in-eyes-band">
          <EyeTracking
            eyeSize={150}
            gap={45}
            irisColor="#6B3A1F"
            irisColorSecondary="#D4A574"
            blinkInterval={3000}
          />
          <p className="in-eyes-copy">
            <b>First, it learns where you look.</b> These two followed your cursor across
            the whole page — the same way EchoLabs follows your gaze during a session.
            Eye contact is scored live, so you learn to hold the camera like you hold a room.
          </p>
          <span className="in-eyes-hint">
            <Eye size={13} /> They have been watching your cursor this whole time
          </span>
        </section>

        <section className="in-section">
          <div className="in-section-head">
            <span className="in-section-eyebrow">The craft / 01</span>
            <h2>How to look and sound confident</h2>
            <p>
              Confidence is not a personality trait — it is a set of small, trainable
              behaviors. Here is the short list EchoLabs listens for.
            </p>
          </div>
          <div className="in-notes">
            {confidenceNotes.map((note) => {
              const Icon = note.icon;
              return (
                <article className="in-note" key={note.title}>
                  <span className="in-note-tag">{note.tag}</span>
                  <div className="in-note-icon"><Icon size={19} /></div>
                  <h3>{note.title}</h3>
                  <p>{note.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="in-section">
          <div className="in-section-head">
            <span className="in-section-eyebrow">The stakes / 02</span>
            <h2>Why does it matter?</h2>
            <p>
              Interviews, standups, first dates, pitches — the people who practice presence
              get remembered. The good news: presence is a skill, and skills compound.
            </p>
          </div>
          <div className="in-why">
            {whyItMatters.map((item) => (
              <article className="in-why-card" key={item.stat}>
                <b>{item.stat}</b>
                <span>{item.body}</span>
              </article>
            ))}
          </div>
          <p className="in-why-quote">
            “People forget your slides. They remember whether you <em>looked like you
            believed it</em>.”
          </p>
        </section>

        <section className="in-section" id="how">
          <div className="in-section-head">
            <span className="in-section-eyebrow">The loop / 03</span>
            <h2>How the tool works</h2>
            <p>
              One loop, four stages. Run it in a coffee break — every session ends with a
              score you earned and one note you can act on.
            </p>
          </div>
          <div className="in-steps">
            {howItWorks.map((item) => {
              const Icon = item.icon;
              return (
                <article className="in-step" key={item.step}>
                  <span className="in-step-num">{item.step}</span>
                  <div className="in-step-icon"><Icon size={19} /></div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="in-final">
          <div className="in-final-card">
            <div className="in-final-eyes">
              <EyeTracking
                eyeSize={64}
                gap={22}
                irisColor="#202536"
                irisColorSecondary="#c3df39"
                blinkInterval={4200}
              />
            </div>
            <h2>Your next conversation is the exam. This is the study room.</h2>
            <p>
              Five questions, five minutes, one honest score. Your camera and microphone
              stay on this device; only the finished transcript is sent to the analysis service.
            </p>
            <Link href="/app" className="in-cta-primary" data-testid="intro-final-cta">
              Take your first assessment <ArrowRight size={15} />
            </Link>
          </div>
        </section>

        <footer className="in-footer">
          <span>EchoLabs — see the real you</span>
          <span>Your voice. Your presence. A brighter you.</span>
        </footer>
      </div>
    </div>
  );
}
