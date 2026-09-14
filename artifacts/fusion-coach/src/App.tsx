import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  BarChart3,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  Hand,
  Headphones,
  Info,
  Keyboard,
  LayoutDashboard,
  Lightbulb,
  Mic,
  MicOff,
  MoreHorizontal,
  Play,
  ScanFace,
  Settings2,
  Sparkles,
  Target,
  Video,
  VideoOff,
  Waves,
  X,
  UserPlus,
  UserRound,
  Users,
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
  score: number | null;
  label: string;
};

type AuthStep = 'chooser' | 'face-id' | 'new-account' | 'guest' | 'signed-in';
type FaceScanState = 'idle' | 'scanning' | 'complete' | 'error';

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
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
  const [authStep, setAuthStep] = useState<AuthStep>('chooser');
  const [identityName, setIdentityName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [faceScanState, setFaceScanState] = useState<FaceScanState>('idle');
  const [active, setActive] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const [speechWords, setSpeechWords] = useState(0);
  const [speechSeconds, setSpeechSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [history, setHistory] = useState(initialHistory);
  const [notice, setNotice] = useState('');
  const [activeNav, setActiveNav] = useState('Practice room');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const savedName = window.localStorage.getItem('fusion-coach.identity');
    if (savedName) {
      setIdentityName(savedName);
      setAuthStep('signed-in');
    }
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraEnabled]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (audioFrameRef.current) window.cancelAnimationFrame(audioFrameRef.current);
    void audioContextRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const startAudioMonitor = (stream: MediaStream) => {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor || stream.getAudioTracks().length === 0) return;
    void audioContextRef.current?.close();
    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    audioContextRef.current = context;

    const sample = () => {
      if (!audioContextRef.current) return;
      analyser.getByteTimeDomainData(data);
      const level = Math.sqrt(data.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0) / data.length);
      setAudioLevel(level);
      if (activeRef.current && level > 0.045) setSpeechSeconds((current) => current + 0.05);
      audioFrameRef.current = window.requestAnimationFrame(sample);
    };
    sample();
  };

  const startSpeechCapture = () => {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let words = 0;
      for (let index = 0; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          words += event.results[index][0].transcript.trim().split(/\s+/).filter(Boolean).length;
        }
      }
      if (words > 0) setSpeechWords(words);
    };
    recognition.onend = () => {
      if (activeRef.current) {
        try {
          recognition.start();
        } catch {
          // The browser may reject an immediate restart while it is settling.
        }
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  };

  const stopSpeechCapture = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

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
      startAudioMonitor(stream);
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
      activeRef.current = false;
      stopSpeechCapture();
      setCompleted(true);
      const hasEvidence = cameraEnabled && micEnabled && speechWords > 0 && speechSeconds >= 1;
      const evidenceScore = hasEvidence
        ? Math.min(100, Math.round(50 + Math.min(25, speechWords / 4) + Math.min(15, speechSeconds * 2) + (cameraEnabled ? 10 : 0)))
        : null;
      setScore(evidenceScore);
      const newItem: HistoryItem = {
        id: `session-${Date.now()}`,
        title: 'Focused communication practice',
        date: 'Just now',
        duration: formatTime(elapsed),
        score: evidenceScore ?? 0,
        label: evidenceScore === null ? 'Needs more evidence' : 'Signal sample',
      };
      setHistory((items) => [newItem, ...items].slice(0, 4));
      setNotice(hasEvidence
        ? 'Session complete. This score reflects signal coverage, not a judgment of your communication.'
        : 'Session complete, but there was not enough evidence to score it. Silence never earns a default score.');
      return;
    }
    if (!cameraEnabled || !micEnabled) {
      setNotice('It’s quiet right now — connect both camera and microphone before starting an evaluation.');
      return;
    }
    setCompleted(false);
    setElapsed(0);
    setScore(null);
    setSpeechWords(0);
    setSpeechSeconds(0);
    setActive(true);
    activeRef.current = true;
    startSpeechCapture();
    setNotice('Session is live. The coach is checking camera presence, microphone activity, and speech — not guessing from silence.');
  };

  const handleNav = (label: string) => {
    setActiveNav(label);
    setNotice('');
  };

  const finishSignIn = (name: string, persist = true) => {
    const cleanName = name.trim();
    if (!cleanName) {
      setNotice('Add a name so the coach knows who it is speaking to.');
      return;
    }
    setIdentityName(cleanName);
    if (persist) window.localStorage.setItem('fusion-coach.identity', cleanName);
    else window.localStorage.removeItem('fusion-coach.identity');
    setAuthStep('signed-in');
    setNameDraft('');
  };

  const beginFaceId = async () => {
    setAuthStep('face-id');
    setFaceScanState('scanning');
    if (!navigator.mediaDevices?.getUserMedia) {
      setFaceScanState('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCameraEnabled(true);
      window.setTimeout(() => {
        setFaceScanState('complete');
        finishSignIn('Returning speaker');
      }, 1200);
    } catch {
      setFaceScanState('error');
    }
  };

  const signOut = () => {
    window.localStorage.removeItem('fusion-coach.identity');
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setIdentityName('');
    setAuthStep('chooser');
    setActiveNav('Practice room');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
      } else if (event.key === ' ') {
        event.preventDefault();
        if (authStep === 'signed-in') toggleSession();
      } else if (event.key.toLowerCase() === 'c' && authStep === 'signed-in') {
        event.preventDefault();
        void toggleCamera();
      } else if (event.key.toLowerCase() === 'm' && authStep === 'signed-in') {
        event.preventDefault();
        void toggleMic();
      } else if (event.key === '1') handleNav('Practice room');
      else if (event.key === '2') handleNav('Session history');
      else if (event.key === '3') handleNav('Progress');
      else if (event.key === '4') handleNav('Settings');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const activeStageIndex = active || completed ? 5 : 1;
  const statusLabel = active ? 'Live session' : completed ? 'Session complete' : 'Ready for practice';
  const speechSupported = Boolean((window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
    ?? (window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  if (authStep !== 'signed-in') {
    return (
      <AuthGate
        step={authStep}
        name={nameDraft}
        faceScanState={faceScanState}
        onNameChange={setNameDraft}
        onFaceId={() => void beginFaceId()}
        onNewAccount={() => setAuthStep('new-account')}
        onGuest={() => setAuthStep('guest')}
        onSubmitName={() => finishSignIn(nameDraft || (authStep === 'guest' ? 'Guest' : ''), authStep !== 'guest')}
        onBack={() => setAuthStep('chooser')}
      />
    );
  }

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
              <div className="fc-avatar">{identityName.slice(0, 2).toUpperCase()}</div>
              <div className="fc-user-text"><b>{identityName}</b><span>Private practice</span></div>
              <MoreHorizontal size={16} color="#858a96" />
            </div>
          </div>
        </aside>

        <main className="fc-main">
          <header className="fc-header">
            <div>
              <div className="fc-eyebrow">Thursday · 14 March 2024</div>
              <h2 className="fc-greeting" data-testid="text-greeting">Good morning, {identityName}</h2>
            </div>
            <div className="fc-header-actions">
              <button className="fc-icon-button fc-mobile-menu" onClick={() => setNotice('Use the workspace tabs on the left to move around Fusion Coach.')} aria-label="Open workspace navigation" data-testid="button-mobile-menu"><LayoutDashboard size={17} /></button>
              <button className="fc-icon-button" onClick={() => setNotice('Your practice data is stored locally in this demo workspace.')} aria-label="Privacy information" data-testid="button-privacy"><Sparkles size={17} /></button>
              <button className="fc-icon-button" onClick={() => handleNav('Settings')} aria-label="Open settings" data-testid="button-settings"><Settings2 size={17} /></button>
            </div>
          </header>

          <div className="fc-main-inner">
            {activeNav !== 'Practice room' && (
              <WorkspaceView
                activeNav={activeNav}
                history={history}
                identityName={identityName}
                onNameChange={(name) => {
                  setIdentityName(name);
                  window.localStorage.setItem('fusion-coach.identity', name);
                  setNotice('Name updated.');
                }}
                onSignOut={signOut}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onStartFaceId={() => void beginFaceId()}
              />
            )}
            {activeNav === 'Practice room' && (<>
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
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="score-title">Live score</h3><span className="fc-card-meta">Fusion readout</span></div><button className="fc-icon-button" onClick={() => handleNav('Progress')} aria-label="View progress"><ArrowUpRight size={17} /></button></div>
                <div className="fc-score-body">
                  <div className={`fc-score-ring ${score === null ? 'empty' : ''}`} data-testid="score-ring"><div className="fc-score-number"><strong data-testid="text-live-score">{score ?? '—'}</strong><span>{score === null ? 'waiting for evidence' : 'signal coverage'}</span></div></div>
                  <div className="fc-score-copy">
                    <h3>{active ? (speechWords > 0 ? 'Evidence is accumulating.' : 'Waiting for your voice.') : completed ? (score === null ? 'Not enough evidence.' : 'Evidence-based round.') : 'No score yet.'}</h3>
                    <p>{active ? 'The session is checking camera presence, microphone activity, speech words, and duration.' : 'A score only appears after real input is captured. Silence never earns a default score.'}</p>
                    <div className="fc-score-trend"><Info /> {speechWords} words · {Math.round(speechSeconds)}s voice activity</div>
                  </div>
                </div>
                <div className="fc-divider" />
                <div className="fc-score-list">
                  <ScoreLine label="Camera signal" value={cameraEnabled ? 100 : 0} />
                  <ScoreLine label="Mic activity" value={micEnabled ? Math.min(100, Math.round(audioLevel * 1200)) : 0} />
                  <ScoreLine label="Speech sample" value={Math.min(100, speechWords * 4)} />
                </div>
              </section>
            </div>

            <div className="fc-bottom-grid">
              <section className="fc-card fc-feedback" aria-labelledby="feedback-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="feedback-title">Coach’s read</h3><span className="fc-card-meta">Specific, not noisy</span></div><Headphones size={17} color="#9ba0a7" /></div>
                <div className="fc-feedback-list">
                  <Feedback icon={<Camera size={14} />} title={cameraEnabled ? 'Camera signal connected' : 'It’s quiet right now'} text={cameraEnabled ? 'The camera is connected. Face recognition is not active in this build, so the app will not pretend a face was detected.' : 'No camera signal is connected. Turn on the camera before asking for a presence evaluation.'} />
                  <Feedback icon={<AudioLines size={14} />} title={micEnabled && audioLevel > 0.045 ? 'Voice activity detected' : 'No speech captured yet'} text={speechSupported ? 'The browser speech engine counts final words. Speak a complete thought so the score has evidence to use.' : 'This browser does not expose speech-to-text. The microphone can still show activity, but no word-level evaluation is available.'} />
                  <Feedback icon={<Info size={14} />} title="How the evaluation works" text="Fusion Coach currently measures device signal, voice activity, speech words, and session duration. It does not infer quality from an empty room." />
                </div>
                <div className="fc-focus"><span>Next round focus</span><b>{score === null ? 'Collect a real voice sample' : 'Review the evidence before repeating'}</b><ChevronRight size={15} color="#c3df39" /></div>
              </section>

              <section className="fc-card fc-history" aria-labelledby="history-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="history-title">Recent sessions</h3><span className="fc-card-meta">Small steps, noticed</span></div><button className="fc-icon-button" onClick={() => handleNav('Session history')} aria-label="View all session history" data-testid="button-view-history"><ChevronRight size={16} /></button></div>
                <div className="fc-history-list">
                  {history.map((item) => <HistoryRow item={item} key={item.id} />)}
                </div>
              </section>
            </div>
            </>)}
          </div>
        </main>
      </div>
      {shortcutsOpen && <ShortcutPanel onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

type WorkspaceViewProps = {
  activeNav: string;
  history: HistoryItem[];
  identityName: string;
  onNameChange: (name: string) => void;
  onSignOut: () => void;
  onOpenShortcuts: () => void;
  onStartFaceId: () => void;
};

function WorkspaceView({ activeNav, history, identityName, onNameChange, onSignOut, onOpenShortcuts, onStartFaceId }: WorkspaceViewProps) {
  const [draftName, setDraftName] = useState(identityName);
  const scoredItems = history.filter((item) => item.score !== null);
  const average = scoredItems.length ? Math.round(scoredItems.reduce((total, item) => total + (item.score ?? 0), 0) / scoredItems.length) : 0;
  const scoredSessions = scoredItems.length;

  if (activeNav === 'Settings') {
    return (
      <section className="fc-workspace-view" aria-labelledby="settings-title">
        <div className="fc-page-heading">
          <div><div className="fc-kicker">Account / 04</div><h1 id="settings-title">Settings</h1><p>Keep your practice identity and controls clear.</p></div>
          <Settings2 size={22} color="#707b18" />
        </div>
        <div className="fc-settings-grid">
          <div className="fc-card fc-settings-card">
            <div className="fc-card-head"><div><h3 className="fc-card-title">Your practice identity</h3><span className="fc-card-meta">Used to greet you in this browser</span></div><UserRound size={17} color="#9ba0a7" /></div>
            <label className="fc-field-label" htmlFor="identity-name">Name</label>
            <input id="identity-name" className="fc-field" value={draftName} onChange={(event) => setDraftName(event.target.value)} />
            <button className="fc-primary-button" onClick={() => onNameChange(draftName.trim() || identityName)}>Save name</button>
          </div>
          <div className="fc-card fc-settings-card">
            <div className="fc-card-head"><div><h3 className="fc-card-title">Face ID sign-in</h3><span className="fc-card-meta">Camera presence scan</span></div><ScanFace size={17} color="#9ba0a7" /></div>
            <p className="fc-settings-copy">Face ID is set up as a presence scan here. It confirms a person is in front of the camera, but does not claim to identify or store a face without a recognition service.</p>
            <button className="fc-secondary-button" onClick={onStartFaceId}><ScanFace size={14} /> Run presence scan</button>
          </div>
          <div className="fc-card fc-settings-card">
            <div className="fc-card-head"><div><h3 className="fc-card-title">Keyboard shortcuts</h3><span className="fc-card-meta">Move without reaching for the mouse</span></div><Keyboard size={17} color="#9ba0a7" /></div>
            <button className="fc-secondary-button" onClick={onOpenShortcuts}><Keyboard size={14} /> View shortcuts</button>
          </div>
          <div className="fc-card fc-settings-card">
            <div className="fc-card-head"><div><h3 className="fc-card-title">This device</h3><span className="fc-card-meta">Local browser session</span></div><Info size={17} color="#9ba0a7" /></div>
            <p className="fc-settings-copy">Your name and demo session history stay in this browser. No biometric template is saved by this interface.</p>
            <button className="fc-danger-button" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </section>
    );
  }

  if (activeNav === 'Progress') {
    return (
      <section className="fc-workspace-view" aria-labelledby="progress-title">
        <div className="fc-page-heading">
          <div><div className="fc-kicker">Workspace / 03</div><h1 id="progress-title">Progress</h1><p>Only measured sessions belong in your trend.</p></div>
          <BarChart3 size={22} color="#707b18" />
        </div>
        <div className="fc-progress-grid">
          <div className="fc-card fc-progress-stat"><span>Measured sessions</span><strong>{scoredSessions}</strong><small>Sessions with speech evidence</small></div>
          <div className="fc-card fc-progress-stat"><span>Average signal coverage</span><strong>{average || '—'}</strong><small>Silence is excluded from scoring</small></div>
          <div className="fc-card fc-progress-stat"><span>Practice identity</span><strong>{identityName}</strong><small>Current local profile</small></div>
        </div>
        <div className="fc-card fc-progress-card">
          <div className="fc-card-head"><div><h3 className="fc-card-title">What changes the score</h3><span className="fc-card-meta">Evidence, not vibes</span></div><CheckCircle2 size={17} color="#9ba0a7" /></div>
          <div className="fc-method-grid">
            <div><b>01 / Camera presence</b><span>Camera must be connected. Face recognition is not claimed without a model.</span></div>
            <div><b>02 / Voice activity</b><span>Microphone energy is sampled while you speak.</span></div>
            <div><b>03 / Speech sample</b><span>Final words from the browser speech engine are counted.</span></div>
            <div><b>04 / Session duration</b><span>A score requires a real sample, not an empty room.</span></div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="fc-workspace-view" aria-labelledby="history-page-title">
      <div className="fc-page-heading">
        <div><div className="fc-kicker">Workspace / 02</div><h1 id="history-page-title">Session history</h1><p>Review what was actually captured in each round.</p></div>
        <Clock3 size={22} color="#707b18" />
      </div>
      <div className="fc-card fc-history-page">
        <div className="fc-card-head"><div><h3 className="fc-card-title">All sessions</h3><span className="fc-card-meta">{history.length} recorded locally</span></div><Users size={17} color="#9ba0a7" /></div>
        <div className="fc-history-list">{history.map((item) => <HistoryRow item={item} key={item.id} />)}</div>
      </div>
    </section>
  );
}

function AuthGate({ step, name, faceScanState, onNameChange, onFaceId, onNewAccount, onGuest, onSubmitName, onBack }: {
  step: AuthStep;
  name: string;
  faceScanState: FaceScanState;
  onNameChange: (name: string) => void;
  onFaceId: () => void;
  onNewAccount: () => void;
  onGuest: () => void;
  onSubmitName: () => void;
  onBack: () => void;
}) {
  const isNameStep = step === 'new-account' || step === 'guest';
  return (
    <div className="fc-auth">
      <div className="fc-auth-card">
        <div className="fc-brand"><div className="fc-brand-mark">F</div><div className="fc-brand-name">fusion<span>.</span></div></div>
        {step === 'chooser' && <>
          <div className="fc-auth-kicker">A private practice room</div>
          <h1>Who is practicing today?</h1>
          <p className="fc-auth-copy">Use a presence scan for an existing account, create a new practice identity, or evaluate as a guest.</p>
          <div className="fc-auth-options">
            <button className="fc-auth-option" onClick={onFaceId}><span className="fc-auth-icon"><ScanFace size={19} /></span><span><b>Continue with Face ID</b><small>Camera presence scan for an existing account</small></span><ChevronRight size={16} /></button>
            <button className="fc-auth-option" onClick={onNewAccount}><span className="fc-auth-icon"><UserPlus size={19} /></span><span><b>Create a new account</b><small>Choose a name for your practice space</small></span><ChevronRight size={16} /></button>
            <button className="fc-auth-option" onClick={onGuest}><span className="fc-auth-icon"><Users size={19} /></span><span><b>Guest evaluation</b><small>Try the room without saving an account</small></span><ChevronRight size={16} /></button>
          </div>
        </>}
        {step === 'face-id' && <>
          <div className="fc-auth-kicker">Existing account / Face ID</div>
          <h1>{faceScanState === 'error' ? 'Camera access is needed.' : faceScanState === 'complete' ? 'Presence confirmed.' : 'Look toward the camera.'}</h1>
          <p className="fc-auth-copy">{faceScanState === 'error' ? 'Allow camera access and try again. This scan does not store a biometric template.' : 'This first pass confirms someone is present. A real identity match needs a connected recognition provider.'}</p>
          <div className={`fc-face-scan ${faceScanState}`}><ScanFace size={64} /><span>{faceScanState === 'scanning' ? 'Scanning presence…' : faceScanState === 'complete' ? 'Scan complete' : 'Scan paused'}</span></div>
          {faceScanState === 'error' && <button className="fc-primary-button" onClick={onFaceId}>Try camera again</button>}
          <button className="fc-text-button" onClick={onBack}>Back</button>
        </>}
        {isNameStep && <>
          <div className="fc-auth-kicker">{step === 'guest' ? 'Guest evaluation' : 'New practice identity'}</div>
          <h1>{step === 'guest' ? 'What should we call you?' : 'Start with your name.'}</h1>
          <p className="fc-auth-copy">{step === 'guest' ? 'Optional — this only personalizes the current browser session.' : 'Your name appears in greetings and stays in this browser.'}</p>
          <label className="fc-field-label" htmlFor="auth-name">Name</label>
          <input id="auth-name" autoFocus className="fc-field" value={name} onChange={(event) => onNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSubmitName(); }} placeholder={step === 'guest' ? 'Guest' : 'Your name'} />
          <button className="fc-primary-button" onClick={onSubmitName}>{step === 'guest' ? 'Start as guest' : 'Create practice space'}</button>
          <button className="fc-text-button" onClick={onBack}>Back</button>
        </>}
      </div>
    </div>
  );
}

function ShortcutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fc-shortcut-backdrop" role="presentation" onClick={onClose}>
      <div className="fc-shortcut-panel" role="dialog" aria-modal="true" aria-labelledby="shortcut-title" onClick={(event) => event.stopPropagation()}>
        <div className="fc-card-head"><div><h3 className="fc-card-title" id="shortcut-title">Keyboard shortcuts</h3><span className="fc-card-meta">Available anywhere outside a text field</span></div><button className="fc-icon-button" onClick={onClose} aria-label="Close shortcuts"><X size={16} /></button></div>
        <div className="fc-shortcut-list"><div><kbd>Space</kbd><span>Start or finish session</span></div><div><kbd>C</kbd><span>Toggle camera</span></div><div><kbd>M</kbd><span>Toggle microphone</span></div><div><kbd>1</kbd><span>Practice room</span></div><div><kbd>2</kbd><span>Session history</span></div><div><kbd>3</kbd><span>Progress</span></div><div><kbd>4</kbd><span>Settings</span></div><div><kbd>?</kbd><span>Show or hide shortcuts</span></div></div>
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
  return <div className="fc-history-item" data-testid={`history-row-${item.id}`}><div><strong>{item.title}</strong><span>{item.date} · {item.duration}</span></div><div className="fc-history-score">{item.score ?? '—'}<small>{item.score === null ? 'no score' : 'score'}</small></div><div className="fc-history-pill">{item.label}</div></div>;
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