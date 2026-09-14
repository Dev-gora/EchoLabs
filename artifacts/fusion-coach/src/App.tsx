import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  BarChart3,
  Camera,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Hand,
  Headphones,
  LayoutDashboard,
  Lightbulb,
  Mic,
  MicOff,
  MoreHorizontal,
  Play,
  Settings2,
  Sparkles,
  Target,
  Video,
  VideoOff,
  Waves,
  X,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type HistoryItem = {
  id: string;
  title: string;
  date: string;
  duration: string;
  score: number;
  label: string;
};

const initialHistory: HistoryItem[] = [
  { id: 'today', title: 'Clearer introductions', date: 'Today, 9:42 AM', duration: '07:18', score: 74, label: 'Good rhythm' },
  { id: 'yesterday', title: 'Team update rehearsal', date: 'Yesterday, 4:16 PM', duration: '11:04', score: 68, label: 'Good progress' },
  { id: 'monday', title: 'Storytelling warm-up', date: 'Mon, 8:31 AM', duration: '05:52', score: 61, label: 'Building' },
];

const stages = [
  { label: 'Capture', sub: 'face · pose · voice', icon: Camera },
  { label: 'Analyze', sub: 'signals in motion', icon: Activity },
  { label: 'Fusion', sub: 'one clear picture', icon: Waves },
  { label: 'Scoring', sub: 'your live read', icon: BarChart3 },
  { label: 'Feedback', sub: 'next best move', icon: Lightbulb },
];

function Home() {
  const [active, setActive] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState(72);
  const [history, setHistory] = useState(initialHistory);
  const [notice, setNotice] = useState('');
  const [activeNav, setActiveNav] = useState('Practice room');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    const scoreTimer = window.setInterval(() => setScore((current) => Math.min(89, current + (Math.random() > .58 ? 1 : 0))), 2200);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(scoreTimer);
    };
  }, [active]);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraEnabled]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const requestDeviceAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionDenied(true);
      setNotice('Live devices are not available here, so Fusion Coach is using a private demo signal.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCameraEnabled(stream.getVideoTracks().length > 0);
      setMicEnabled(stream.getAudioTracks().length > 0);
      setPermissionDenied(false);
      setNotice('Camera and microphone are connected. Your practice stays in this browser.');
    } catch {
      setPermissionDenied(true);
      setNotice('Device access was not granted. Demo mode is on — you can still practice the full loop.');
    }
  };

  const toggleCamera = async () => {
    if (cameraEnabled) {
      streamRef.current?.getVideoTracks().forEach((track) => track.stop());
      setCameraEnabled(false);
      setNotice('Camera signal paused. Demo tracking is standing by.');
      return;
    }
    await requestDeviceAccess();
  };

  const toggleMic = async () => {
    if (micEnabled) {
      streamRef.current?.getAudioTracks().forEach((track) => track.stop());
      setMicEnabled(false);
      setNotice('Microphone signal paused. You can continue with demo audio.');
      return;
    }
    await requestDeviceAccess();
  };

  const toggleSession = () => {
    if (active) {
      setActive(false);
      setCompleted(true);
      const newItem: HistoryItem = {
        id: `session-${Date.now()}`,
        title: 'Focused communication practice',
        date: 'Just now',
        duration: formatTime(elapsed),
        score,
        label: score > 70 ? 'Good rhythm' : 'Building',
      };
      setHistory((items) => [newItem, ...items].slice(0, 4));
      setNotice('Session complete. One small focus is ready for your next round.');
      return;
    }
    setCompleted(false);
    setElapsed(0);
    setScore(72);
    setActive(true);
    setNotice('Session is live. Speak naturally — the coach is listening for patterns, not perfection.');
  };

  const handleNav = (label: string) => {
    setActiveNav(label);
    setNotice(label === 'Practice room' ? '' : `${label} view is part of this focused workspace.`);
  };

  const activeStageIndex = active || completed ? 5 : 1;
  const statusLabel = active ? 'Live session' : completed ? 'Session complete' : 'Ready for practice';

  return (
    <div className="fc-app">
      <div className="fc-shell">
        <aside className="fc-sidebar">
          <div className="fc-brand" data-testid="brand-fusion-coach">
            <div className="fc-brand-mark">F</div>
            <div className="fc-brand-name">fusion<span>.</span></div>
          </div>
          <div className="fc-nav-label">Workspace</div>
          <nav className="fc-nav" aria-label="Main navigation">
            <button className={`fc-nav-item ${activeNav === 'Practice room' ? 'active' : ''}`} onClick={() => handleNav('Practice room')} data-testid="nav-practice-room">
              <LayoutDashboard /> <span>Practice room</span>
            </button>
            <button className={`fc-nav-item ${activeNav === 'Session history' ? 'active' : ''}`} onClick={() => handleNav('Session history')} data-testid="nav-session-history">
              <Clock3 /> <span>Session history</span>
            </button>
            <button className={`fc-nav-item ${activeNav === 'Progress' ? 'active' : ''}`} onClick={() => handleNav('Progress')} data-testid="nav-progress">
              <BarChart3 /> <span>Progress</span>
            </button>
          </nav>
          <div className="fc-sidebar-bottom">
            <div className="fc-coach-note">
              <p>One useful note at a time. Your attention is the practice.</p>
              <strong>Today's intention →</strong>
            </div>
            <div className="fc-nav-label">Account</div>
            <button className={`fc-nav-item ${activeNav === 'Settings' ? 'active' : ''}`} onClick={() => handleNav('Settings')} data-testid="nav-settings">
              <Settings2 /> <span>Settings</span>
            </button>
            <div className="fc-user" data-testid="user-profile">
              <div className="fc-avatar">MC</div>
              <div className="fc-user-text"><b>Maya Chen</b><span>Private practice</span></div>
              <MoreHorizontal size={16} color="#858a96" />
            </div>
          </div>
        </aside>

        <main className="fc-main">
          <header className="fc-header">
            <div>
              <div className="fc-eyebrow">Thursday · 14 March 2024</div>
              <h2 className="fc-greeting" data-testid="text-greeting">Good morning, Maya</h2>
            </div>
            <div className="fc-header-actions">
              <button className="fc-icon-button fc-mobile-menu" onClick={() => setNotice('Use the workspace tabs on the left to move around Fusion Coach.')} aria-label="Open workspace navigation" data-testid="button-mobile-menu"><LayoutDashboard size={17} /></button>
              <button className="fc-icon-button" onClick={() => setNotice('Your practice data is stored locally in this demo workspace.')} aria-label="Privacy information" data-testid="button-privacy"><Sparkles size={17} /></button>
              <button className="fc-icon-button" onClick={() => handleNav('Settings')} aria-label="Open settings" data-testid="button-settings"><Settings2 size={17} /></button>
            </div>
          </header>

          <div className="fc-main-inner">
            <section className="fc-hero" aria-labelledby="hero-title">
              <div className="fc-hero-top">
                <div>
                  <div className="fc-kicker">Private practice room / 01</div>
                  <h1 id="hero-title">Make the next sentence land.</h1>
                  <p className="fc-hero-sub">A quiet space to notice how your words, voice, and presence work together. Start when you’re ready.</p>
                </div>
                <div className="fc-status-chip" data-testid="status-session"><i className={`fc-status-dot ${active ? 'active' : ''}`} />{statusLabel}</div>
              </div>
              <div className="fc-pipeline" aria-label="Communication coaching pipeline">
                {stages.map((stage, index) => {
                  const Icon = stage.icon;
                  const isStageActive = index < activeStageIndex;
                  return (
                    <div className={`fc-stage ${isStageActive ? 'active' : ''}`} key={stage.label} data-testid={`stage-${stage.label.toLowerCase()}`}>
                      <div className="fc-stage-icon"><Icon size={16} /></div>
                      <div className="fc-stage-copy"><b>{stage.label}</b><span>{stage.sub}</span></div>
                    </div>
                  );
                })}
              </div>
            </section>

            {notice && (
              <div className="fc-notice" data-testid="status-notice">
                <span><Check size={14} /> {notice}</span>
                <button onClick={() => setNotice('')} aria-label="Dismiss notice" data-testid="button-dismiss-notice"><X size={14} /></button>
              </div>
            )}

            <div className="fc-content-grid">
              <section className="fc-card fc-session" aria-labelledby="session-title">
                <div className="fc-card-head">
                  <div><h3 className="fc-card-title" id="session-title">Live practice</h3><span className="fc-card-meta">{active ? 'Fusion engine listening' : 'Camera + microphone signals'}</span></div>
                  <span className="fc-card-meta">{formatTime(elapsed)}</span>
                </div>
                <div className="fc-camera" data-testid="camera-preview">
                  {cameraEnabled ? <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" /> : (
                    <>
                      <div className="fc-camera-grid" />
                      <div className="fc-camera-glow" />
                      <div className="fc-silhouette"><div className="fc-head-shape" /><div className="fc-body-shape" /></div>
                      <div className="fc-tracking" />
                      <div className="fc-track-label">{permissionDenied ? 'DEMO SIGNAL / READY' : active ? 'DEMO SIGNAL / TRACKING' : 'DEMO SIGNAL / STANDBY'}</div>
                    </>
                  )}
                  {cameraEnabled && <div className="fc-camera-grid" />}
                  <div className="fc-camera-bottom">
                    <div className="fc-waveform" aria-label="Audio signal visualization">{[1, 2, 3, 4, 5, 6].map((bar) => <i key={bar} />)}</div>
                    <span className="fc-camera-time">{active ? '00:' + formatTime(elapsed) : 'signal preview'}</span>
                  </div>
                  {!cameraEnabled && permissionDenied && <div className="fc-camera-off"><div><VideoOff size={22} /><span>Demo mode is ready while devices are unavailable</span></div></div>}
                </div>
                <div className="fc-session-controls">
                  <div className="fc-device-controls">
                    <button className={`fc-control ${!cameraEnabled ? 'off' : ''}`} onClick={toggleCamera} data-testid="button-toggle-camera">{cameraEnabled ? <Video size={14} /> : <VideoOff size={14} />}{cameraEnabled ? 'Camera on' : 'Camera off'}</button>
                    <button className={`fc-control ${!micEnabled ? 'off' : ''}`} onClick={toggleMic} data-testid="button-toggle-microphone">{micEnabled ? <Mic size={14} /> : <MicOff size={14} />}{micEnabled ? 'Mic on' : 'Mic off'}</button>
                  </div>
                  <button className={`fc-start ${active ? 'active' : ''}`} onClick={toggleSession} data-testid="button-session-toggle">
                    {active ? <CircleStop size={15} /> : <Play size={15} fill="currentColor" />} {active ? 'Finish session' : completed ? 'Practice again' : 'Start session'}
                  </button>
                </div>
              </section>

              <section className="fc-card fc-score-card" aria-labelledby="score-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="score-title">Live score</h3><span className="fc-card-meta">Fusion readout</span></div><ArrowUpRight size={17} color="#9ba0a7" /></div>
                <div className="fc-score-body">
                  <div className="fc-score-ring" data-testid="score-ring"><div className="fc-score-number"><strong data-testid="text-live-score">{score}</strong><span>out of 100</span></div></div>
                  <div className="fc-score-copy">
                    <h3>{active ? 'You’re finding your pace.' : completed ? 'A useful round.' : 'Your baseline is ready.'}</h3>
                    <p>{active ? 'Steady voice energy and open posture are working together. Keep going.' : 'Start a session to see how your presence and language combine in the moment.'}</p>
                    <div className="fc-score-trend"><ArrowUpRight /> +6 from your last session</div>
                  </div>
                </div>
                <div className="fc-divider" />
                <div className="fc-score-list">
                  <ScoreLine label="Clarity" value={78} />
                  <ScoreLine label="Vocal energy" value={69} />
                  <ScoreLine label="Presence" value={74} />
                </div>
              </section>
            </div>

            <div className="fc-bottom-grid">
              <section className="fc-card fc-feedback" aria-labelledby="feedback-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="feedback-title">Coach’s read</h3><span className="fc-card-meta">Specific, not noisy</span></div><Headphones size={17} color="#9ba0a7" /></div>
                <div className="fc-feedback-list">
                  <Feedback icon={<Target size={14} />} title="Try a cleaner landing" text="Your point is strong. Give the final phrase half a beat more space before moving on." />
                  <Feedback icon={<AudioLines size={14} />} title="Let your voice travel" text="Energy dipped near the middle of the thought. Lift the last few words slightly." />
                  <Feedback icon={<Hand size={14} />} title="Hands are helping" text="Your gestures are open and timed well with emphasis. Keep that natural range." />
                </div>
                <div className="fc-focus"><span>Next round focus</span><b>Leave space after the point</b><ChevronRight size={15} color="#c3df39" /></div>
              </section>

              <section className="fc-card fc-history" aria-labelledby="history-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="history-title">Recent sessions</h3><span className="fc-card-meta">Small steps, noticed</span></div><button className="fc-icon-button" onClick={() => handleNav('Session history')} aria-label="View all session history" data-testid="button-view-history"><ChevronRight size={16} /></button></div>
                <div className="fc-history-list">
                  {history.map((item) => <HistoryRow item={item} key={item.id} />)}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ScoreLine({ label, value }: { label: string; value: number }) {
  return <div className="fc-score-line" data-testid={`metric-${label.toLowerCase().replace(' ', '-')}`}><label>{label}</label><div className="fc-bar"><i style={{ width: `${value}%` }} /></div><b>{value}</b></div>;
}

function Feedback({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="fc-feedback-row"><div className="fc-feedback-icon">{icon}</div><div><h4>{title}</h4><p>{text}</p></div></div>;
}

function HistoryRow({ item }: { item: HistoryItem }) {
  return <div className="fc-history-item" data-testid={`history-row-${item.id}`}><div><strong>{item.title}</strong><span>{item.date} · {item.duration}</span></div><div className="fc-history-score">{item.score}<small>score</small></div><div className="fc-history-pill">{item.label}</div></div>;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;