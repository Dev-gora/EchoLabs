import {
  Show,
  SignIn,
  SignUp,
  UserButton,
  useAuth,
  useUser,
} from '@clerk/react';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  Suspense,
} from 'react';

import {
  ChevronRight,
  Circle,
  Mic,
  MicOff,
  LogOut,
  UserRound,
} from 'lucide-react';
import {
  Card,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
} from '@/components/ui';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/lib/use-toast';
import {
  baseClient,
  type EchoLabsSupabaseClient,
  fetchUserSessions,
  insertSession,
  updateSessionScore,
} from '@/integrations/supabase';

type HistoryItem = {
  id: string;
  userId: string;
  username: string;
  date: string;
  score: number | null;
  status: 'completed' | 'guest' | 'failed';
  mistakes: { time: number; label: string; kind: 'good' | 'issue' }[];
};

type SessionStats = {
  totalSessions: number;
  averageScore: number;
  totalTime: number;
  totalWords: number;
};

type CameraDevice = { deviceId: string; label: string };
type MicDevice = { deviceId: string; label: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/**
 * Deterministic delivery proxy so ending a session always produces a score the
 * speaker earned: reward a pace near 140 words per minute, and require enough
 * speech for the number to mean anything.
 */
function computeDeliveryScore(words: number, elapsedMs: number): number {
  const seconds = Math.max(1, elapsedMs / 1000);
  const wordsPerMinute = (words / seconds) * 60;
  const pace = Math.max(0, 100 - Math.abs(wordsPerMinute - 140) * 0.6);
  const substance = Math.min(100, words * 2);
  return Math.round((pace * 0.6 + substance * 0.4) * 10) / 10;
}

function AppContent() {
  const [active, setActive] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [speechWords, setSpeechWords] = useState(0);
  const [speechSeconds, setSpeechSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [faceBox, setFaceBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [faceKeypoints, setFaceKeypoints] = useState<
    Array<{ x: number; y: number; z?: number; visibility?: number }>
  >([]);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraDevice | null>(
    null,
  );
  const [selectedMic, setSelectedMic] = useState<MicDevice | null>(null);
  const [userClient, setUserClient] = useState<EchoLabsSupabaseClient | null>(
    null,
  );

  const { userId, getToken, signOut } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    let cancelled = false;

    async function bindClient() {
      if (!userId) {
        setUserClient(baseClient);
        return;
      }
      const getSessionToken = async () => {
        try {
          const token = await getToken();
          return typeof token === 'string' ? token : null;
        } catch {
          return null;
        }
      };
      const client = await import('@/integrations/supabase').then(
        (m) =>
          m.getAuthenticatedClient(getSessionToken) as Promise<EchoLabsSupabaseClient>,
      );
      if (!cancelled) setUserClient(client);
    }

    bindClient();
    return () => {
      cancelled = true;
    };
  }, [userId, getToken]);

  useEffect(() => {
    const saved = localStorage.getItem('echo_labs_user_prefs');
    if (saved) {
      try {
        const prefs = JSON.parse(saved);
        setSelectedCamera(prefs.selectedCamera || null);
        setSelectedMic(prefs.selectedMic || null);
      } catch {
        /* ignore bad JSON */
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'echo_labs_user_prefs',
      JSON.stringify({
        selectedCamera: selectedCamera?.deviceId,
        selectedMic: selectedMic?.deviceId,
      }),
    );
  }, [selectedCamera, selectedMic]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const cameras = devices
          .filter((d) => d.kind === 'videoinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label:
              d.label || `Camera ${devices.indexOf(d) + 1}`,
          }));
        const mics = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: `Mic ${devices.indexOf(d) + 1}`,
          }));
        setCameraDevices(cameras);
        setMicDevices(mics);
        if (cameras.length > 0) setSelectedCamera(cameras[0]);
        if (mics.length > 0) setSelectedMic(mics[0]);
      })
      .catch((err) => console.error('Error enumerating devices:', err));
  }, []);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [userStats, setUserStats] = useState<SessionStats>({
    totalSessions: 0,
    averageScore: 0,
    totalTime: 0,
    totalWords: 0,
  });

  const fetchHistory = useCallback(async () => {
    if (!userId || !userClient) {
      setHistory([]);
      return;
    }
    try {
      const items = await fetchUserSessions(userClient, userId);
      setHistory(
        items.map((item) => ({
          id: item.id,
          userId,
          username:
            user?.fullName ||
            user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
            'User',
          date: item.date,
          score: item.score,
          status: 'completed' as const,
          mistakes: [],
        })),
      );
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  }, [userId, user, userClient]);

  const fetchUserStats = useCallback(async () => {
    if (!userId) {
      setUserStats({
        totalSessions: 0,
        averageScore: 0,
        totalTime: 0,
        totalWords: 0,
      });
      return;
    }
    try {
      const calculatedSessions = typeof window !== 'undefined' ? history : [];
      setUserStats({
        totalSessions: calculatedSessions.length,
        averageScore:
          calculatedSessions.length > 0
            ? calculatedSessions.reduce((s, i) => s + (i.score ?? 0), 0) /
              calculatedSessions.length
            : 0,
        totalTime: 0,
        totalWords: 0,
      });
    } catch (error) {
      console.error('Error fetching user stats:', error);
    }
  }, [userId, history]);

  useEffect(() => {
    if (userId) {
      fetchHistory();
      fetchUserStats();
    }
  }, [userId, fetchHistory, fetchUserStats]);

  const stopCapture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setAudioLevel(0);
  }, []);

  const startCapture = useCallback(async () => {
    setMediaError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError(
        'This browser has no camera or microphone capture. Try Chrome or Edge.',
      );
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: selectedCamera
          ? { deviceId: { exact: selectedCamera.deviceId } }
          : true,
        audio: selectedMic ? { deviceId: { exact: selectedMic.deviceId } } : true,
      });

      streamRef.current = media;
      setStream(media);

      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - startedAt;
        setElapsed(ms);
        setSpeechSeconds(Math.round(ms / 1000));
      }, 200);

      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextCtor) {
        const context = new AudioContextCtor();
        audioContextRef.current = context;
        void context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(media).connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            sum += buffer[i] * buffer[i];
          }
          setAudioLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 6));
          meterFrameRef.current = requestAnimationFrame(tick);
        };
        meterFrameRef.current = requestAnimationFrame(tick);
      }

      const speechWindow = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      };
      const RecognitionCtor =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (RecognitionCtor) {
        const recognition = new RecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
          let spoken = '';
          for (let i = 0; i < event.results.length; i += 1) {
            spoken += `${event.results[i][0].transcript} `;
          }
          const clean = spoken.replace(/\s+/g, ' ').trim();
          setTranscript(clean);
          setSpeechWords(clean ? clean.split(' ').length : 0);
        };
        recognition.onend = () => {
          if (recognitionRef.current === recognition) {
            try {
              recognition.start();
            } catch {
              /* the session is closing */
            }
          }
        };
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (error) {
      setMediaError(
        error instanceof Error
          ? error.message
          : 'Could not start the camera or microphone.',
      );
    }
  }, [selectedCamera, selectedMic]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, active]);

  useEffect(() => () => stopCapture(), [stopCapture]);

  const handleStartSession = useCallback(async () => {
    setActive(true);
    setCompleted(false);
    setScore(null);
    setSpeechWords(0);
    setSpeechSeconds(0);
    setElapsed(0);
    setAudioLevel(0);
    setMicMuted(false);
    setTranscript('');
    setFaceBox(null);
    setFaceKeypoints([]);

    await startCapture();

    if (userId && userClient) {
      try {
        const sessionId = await insertSession(userClient, {
          user_id: userId,
          score: null,
          status: 'in_progress',
          date: new Date().toISOString(),
          camera_id: selectedCamera?.deviceId,
          mic_id: selectedMic?.deviceId,
        });
        if (!sessionId) console.error('Error creating session');
      } catch (error) {
        console.error('Error creating session:', error);
      }
    }
  }, [userId, userClient, selectedCamera, selectedMic, startCapture]);

  const handleEndSession = useCallback(async () => {
    const finishedScore = computeDeliveryScore(speechWords, elapsed);

    stopCapture();
    setActive(false);
    setCompleted(true);
    setScore(finishedScore);

    if (userId && userClient) {
      try {
        await updateSessionScore(userClient, 'current', finishedScore, []);
        await fetchHistory();
        await fetchUserStats();
      } catch (error) {
        console.error('Error saving session:', error);
      }
    }
  }, [
    userId,
    userClient,
    speechWords,
    elapsed,
    stopCapture,
    fetchHistory,
    fetchUserStats,
  ]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setSelectedCamera(null);
    setSelectedMic(null);
    localStorage.removeItem('echo_labs_user_prefs');
    toast({
      title: 'Signed Out',
      description: 'You have been signed out successfully.',
    });
  }, [signOut]);

  const handleViewGuestScore = useCallback(() => {
    const guestSession = JSON.parse(
      localStorage.getItem('current_guest_session') || '{}',
    );
    if (guestSession.score !== null && guestSession.score !== undefined) {
      toast({
        title: 'Guest Session Score',
        description: `Your guest session score: ${guestSession.score}`,
      });
    } else {
      toast({
        title: 'No Score',
        description: 'No score was recorded for this guest session.',
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <div className="relative min-h-screen">
        <aside className="fixed left-0 top-0 h-full w-72 bg-card/90 border-r border-border flex flex-col z-40">
          <div className="p-5 flex-1 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Settings</h2>
              {user?.primaryEmailAddress?.emailAddress && (
                <div className="text-xs text-muted-foreground">
                  {user.primaryEmailAddress.emailAddress.split('@')[0]}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Camera</Label>
              <Select
                value={selectedCamera?.deviceId ?? ''}
                onValueChange={(v: string) => {
                  const found = cameraDevices.find((d) => d.deviceId === v);
                  setSelectedCamera(found || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {cameraDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Microphone</Label>
              <Select
                value={selectedMic?.deviceId ?? ''}
                onValueChange={(v: string) => {
                  const found = micDevices.find((d) => d.deviceId === v);
                  setSelectedMic(found || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {micDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {userId && (
              <Card>
                <div className="p-5 space-y-3">
                  <h3 className="text-sm font-medium">Session Stats</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Sessions
                      </p>
                      <p className="font-bold text-lg">
                        {history.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Score</p>
                      <p className="font-bold text-lg">
                        {history.length > 0
                          ? (history.reduce((s, i) => s + (i.score ?? 0), 0) /
                              history.length).toFixed(1)
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Best</p>
                      <p className="font-bold text-lg">
                        {history.length > 0
                          ? Math.max(...history.map((i) => i.score ?? 0)).toFixed(
                              1,
                            )
                          : '—'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {userStats.totalSessions} tracked sessions
                  </p>
                </div>
              </Card>
            )}

            {userId && (
              <button
                onClick={handleSignOut}
                className="w-full bg-destructive/10 text-destructive rounded-lg py-2 hover:bg-destructive/20 flex items-center justify-between"
              >
                Sign Out
                <LogOut className="w-4 h-4" />
              </button>
            )}

            {userId && <UserButton />}
          </div>
        </aside>

        <main className="pl-72 min-h-screen flex flex-col">
          <header className="p-6 pb-2 border-b border-border">
            <img
              src={`${import.meta.env.BASE_URL}brand/logo.svg`}
              alt="EchoLabs — speech assessment"
              className="h-16 w-auto"
            />
            <p className="text-sm text-muted-foreground mt-1">
              Real-time delivery and voice coaching
            </p>
          </header>

          {!active && userId && (
            <Card className="mx-6 mt-6 max-w-2xl">
              <div className="p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <img
                    src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`}
                    alt=""
                    aria-hidden="true"
                    className="h-7 w-auto"
                  />
                  <h2 className="text-xl font-bold">Set up your session</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Pick a camera and microphone, then start. Your session will
                  be saved to your history.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Camera</Label>
                    <Select
                      value={selectedCamera?.deviceId ?? ''}
                      onValueChange={(v: string) => {
                        const found = cameraDevices.find(
                          (d) => d.deviceId === v,
                        );
                        setSelectedCamera(found || null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select camera" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {cameraDevices.map((device) => (
                          <SelectItem
                            key={device.deviceId}
                            value={device.deviceId}
                          >
                            {device.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Microphone
                    </Label>
                    <Select
                      value={selectedMic?.deviceId ?? ''}
                      onValueChange={(v: string) => {
                        const found = micDevices.find(
                          (d) => d.deviceId === v,
                        );
                        setSelectedMic(found || null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {micDevices.map((device) => (
                          <SelectItem
                            key={device.deviceId}
                            value={device.deviceId}
                          >
                            {device.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <button
                  onClick={handleStartSession}
                  disabled={
                    (!selectedCamera || !selectedMic) &&
                    cameraDevices.length > 0 &&
                    micDevices.length > 0
                  }
                  className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(!selectedCamera || !selectedMic) &&
                  cameraDevices.length > 0 &&
                  micDevices.length > 0
                    ? 'Select camera and microphone'
                    : 'Start Session'}
                </button>
              </div>
            </Card>
          )}

          {active && (
            <div className="flex-1 relative">
              {mediaError && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 max-w-md bg-destructive/10 text-destructive border border-destructive/30 rounded-lg px-4 py-2 text-sm text-center">
                  {mediaError}
                </div>
              )}

              <div className="absolute top-6 right-6 bg-card/90 backdrop-blur-sm rounded-xl p-4 min-w-48 shadow-lg">
                <p className="text-xs text-muted-foreground mb-1">Score</p>
                <p
                  className={`text-4xl font-bold ${
                    score !== null ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {score !== null ? score.toFixed(1) : '--'}
                </p>
              </div>

              <div className="absolute top-6 left-6 bg-card/90 backdrop-blur-sm rounded-xl p-4 shadow-lg">
                <p className="text-xs text-muted-foreground mb-1">Time</p>
                <p className="text-4xl font-bold">
                  {Math.round(elapsed / 1000)}s
                </p>
              </div>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                <div className="bg-card/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg flex items-center gap-3">
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className={`w-1 bg-primary transition-all ${
                          audioLevel > 0.1 + i * 0.1
                            ? 'h-6'
                            : 'h-2'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {speechWords} words · {speechSeconds}s speech
                  </p>
                </div>
              </div>

              {faceBox && (
                <div
                  className="absolute border-2 border-primary/60 rounded"
                  style={{
                    left: faceBox.x,
                    top: faceBox.y,
                    width: faceBox.width,
                    height: faceBox.height,
                  }}
                >
                  {faceKeypoints.map((p, i) =>
                    p.visibility !== 0 ? (
                      <div
                        key={i}
                        className="absolute w-2 h-2 bg-primary rounded-full"
                        style={{
                          left: p.x - 4,
                          top: p.y - 4,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              )}

              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 h-full w-full object-cover bg-black"
              />

              {transcript && (
                <div className="absolute bottom-20 left-6 right-6 bg-card/90 backdrop-blur-sm rounded-lg p-4 max-h-48 overflow-y-auto text-sm shadow-lg">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">
                    Transcript
                  </p>
                  <p className="whitespace-pre-wrap">{transcript}</p>
                </div>
              )}

              <div className="absolute bottom-6 right-6 flex gap-3">
                <button
                  onClick={() => {
                    const nextMuted = !micMuted;
                    streamRef.current
                      ?.getAudioTracks()
                      .forEach((track) => {
                        track.enabled = !nextMuted;
                      });
                    setMicMuted(nextMuted);
                  }}
                  className="w-12 h-12 bg-primary rounded-full flex items-center justify-center hover:bg-primary/90 shadow-lg"
                  aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {micMuted ? (
                    <MicOff className="w-6 h-6 text-primary-foreground" />
                  ) : (
                    <Mic className="w-6 h-6 text-primary-foreground" />
                  )}
                </button>
                <button
                  onClick={handleEndSession}
                  className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center hover:bg-secondary/90 shadow-lg"
                  aria-label="End session"
                >
                  <Circle className="w-6 h-6 text-secondary-foreground" />
                </button>
              </div>
            </div>
          )}

          {completed && score !== null && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
              <Card className="max-w-md w-full mx-6 p-8 text-center">
                <div className="mb-4">
                  <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/20 mb-2">
                    <img
                      src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`}
                      alt=""
                      aria-hidden="true"
                      className="h-8 w-auto"
                    />
                  </div>
                  <p className="text-5xl font-bold text-primary">
                    {score.toFixed(1)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your score
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setActive(false);
                      setCompleted(false);
                      setScore(null);
                      setSpeechWords(0);
                      setSpeechSeconds(0);
                      setElapsed(0);
                      setAudioLevel(0);
                      setMicMuted(false);
                      setMediaError(null);
                      setTranscript('');
                      setFaceBox(null);
                      setFaceKeypoints([]);
                    }}
                    className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 hover:bg-primary/90"
                  >
                    New Session
                  </button>
                  <button
                    onClick={handleViewGuestScore}
                    className="flex-1 bg-muted text-muted-foreground rounded-lg py-2 hover:bg-muted/80"
                  >
                    Session Summary
                  </button>
                </div>
              </Card>
            </div>
          )}

          {userId && !completed && !active && history.length > 0 && (
            <Card className="mx-6 mt-6 max-w-2xl">
              <div className="p-6">
                <h3 className="text-lg font-medium mb-4">Your History</h3>
                <div className="space-y-3">
                  {history.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border"
                    >
                      <div>
                        <p className="font-medium">
                          {item.username || 'You'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        {item.score !== null && (
                          <p className="font-bold text-primary">
                            {item.score.toFixed(1)}
                          </p>
                        )}
                        <Badge variant="secondary" className="mt-1">
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {!userId && (
            <Card className="mx-6 mt-6 max-w-2xl">
              <div className="p-6 text-center">
                <img
                  src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`}
                  alt=""
                  aria-hidden="true"
                  className="h-12 w-auto mx-auto mb-3 opacity-80"
                />
                <h3 className="font-medium mb-1">Guest Session</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Your score will appear here after the session ends. History
                  is not saved for guests — sign up to keep your practice
                  history.
                </p>
                <button
                  onClick={handleViewGuestScore}
                  className="bg-primary text-primary-foreground rounded-lg py-2 px-4 font-medium hover:bg-primary/90"
                >
                  View Guest Score
                </button>
              </div>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

function AuthChooser({ onGuest }: { onGuest: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');

  return (
    <div className="min-h-screen bg-background font-sans antialiased flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="bg-card rounded-xl p-8 shadow-2xl">
          <img
            src={`${import.meta.env.BASE_URL}brand/logo.svg`}
            alt="EchoLabs — speech assessment"
            className="h-20 w-auto mx-auto mb-5"
          />
          <h2 className="text-2xl font-bold mb-2">Welcome</h2>
          <p className="text-muted-foreground mb-6">
            Improve your voice and delivery with AI-powered coaching.
          </p>
          <div className="space-y-3">
            {mode === 'sign-in' ? (
              <SignIn routing="hash" />
            ) : (
              <SignUp routing="hash" />
            )}
            <style>{`
              .cl-card { min-width: 280px; }
            `}</style>
            <button
              onClick={() =>
                setMode((prev) =>
                  prev === 'sign-in' ? 'sign-up' : 'sign-in',
                )
              }
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground w-full"
            >
              {mode === 'sign-in'
                ? 'New here? Create an account'
                : 'Already have an account? Sign in'}
            </button>
            <button
              onClick={() => {
                const guestSession = {
                  id: `guest-${Date.now()}`,
                  userId: `guest-${Date.now()}`,
                  username: 'Guest',
                  date: new Date().toISOString(),
                  status: 'guest' as const,
                  score: null as null,
                  mistakes: [] as {
                    time: number;
                    label: string;
                    kind: 'good' | 'issue';
                  }[],
                };
                localStorage.setItem(
                  'current_guest_session',
                  JSON.stringify(guestSession),
                );
                onGuest();
              }}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <UserRound className="w-4 h-4 text-muted-foreground" />
                Continue as Guest
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const [isGuest, setIsGuest] = useState(
    () =>
      typeof window !== 'undefined' &&
      localStorage.getItem('current_guest_session') !== null,
  );

  if (isGuest) {
    return (
      <>
        <AppContent />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <Show when="signed-in">
        <AppContent />
      </Show>
      <Show when="signed-out">
        <Suspense fallback={null}>
          <AuthChooser onGuest={() => setIsGuest(true)} />
        </Suspense>
      </Show>
      <Toaster />
    </>
  );
}

export default Home;
