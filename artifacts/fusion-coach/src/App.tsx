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
  LogOut,
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
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FaceDetector, FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { ErrorBoundary } from '@/components/error-boundary';
import VoiceLab from '@/components/voice-lab';
import { requestDeliveryRead, type DeliveryRead } from '@/lib/delivery';
import {
  MONITOR_CONFIG,
  RealtimeVoiceMonitor,
  type MonitorSnapshot,
  type VoiceAlert,
  type VoiceSummary,
} from '@/lib/realtime-monitor';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Intro from '@/pages/intro';
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

type AuthStep = 'chooser' | 'new-account' | 'guest' | 'signed-in';
type OverlayView = 'human-eye' | 'ai' | 'tracking' | 'transcript' | 'frequency' | 'scores';
type FaceBox = { x: number; y: number; width: number; height: number };
type TrackerStatus = 'unavailable' | 'loading' | 'ready' | 'detected';
type LandmarkPoint = { x: number; y: number; z?: number; visibility?: number };
type ReviewMarker = { time: number; label: string; kind: 'good' | 'issue' };
type ScoreBreakdown = {
  base: number;
  issueDeduction: number;
  final: number;
  reason: string;
  unmet: string[];
  wordRate: number;
  scored: boolean;
};

/** Seconds one realtime alert stays visible on screen. */
const ALERT_VISIBLE_MS = 3000;

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

// Evidence thresholds: a session is only scored once all of these are met.
const MIN_SPEECH_WORDS = 40;
const MIN_SPEECH_SECONDS = 20;
const MIN_SESSION_SECONDS = 30;
const MIC_ACTIVE_THRESHOLD = 0.045;

function Home() {
  const [authStep, setAuthStep] = useState<AuthStep>('chooser');
  const [identityName, setIdentityName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
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
  const [transcript, setTranscript] = useState('');
  const [frequencyData, setFrequencyData] = useState<number[]>(Array.from({ length: 24 }, () => 0));
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [faceKeypoints, setFaceKeypoints] = useState<LandmarkPoint[]>([]);
  const [poseLandmarks, setPoseLandmarks] = useState<LandmarkPoint[]>([]);
  const [handLandmarks, setHandLandmarks] = useState<LandmarkPoint[][]>([]);
  const [faceRecognitionStatus, setFaceRecognitionStatus] = useState<'unavailable' | 'searching' | 'detected'>('unavailable');
  const [poseStatus, setPoseStatus] = useState<TrackerStatus>('unavailable');
  const [handStatus, setHandStatus] = useState<TrackerStatus>('unavailable');
  const [history, setHistory] = useState(initialHistory);
  const [notice, setNotice] = useState('');
  const [activeNav, setActiveNav] = useState('Practice room');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [overlay, setOverlay] = useState<OverlayView | null>(null);
  const [paused, setPaused] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [reviewMarkers, setReviewMarkers] = useState<ReviewMarker[]>([]);
  const [scoreBreakdown, setScoreBreakdown] = useState<ScoreBreakdown | null>(null);
  const [delivery, setDelivery] = useState<DeliveryRead | null>(null);
  const [monitorSnapshot, setMonitorSnapshot] = useState<MonitorSnapshot | null>(null);
  const [voiceSummary, setVoiceSummary] = useState<VoiceSummary | null>(null);
  const [voiceAlerts, setVoiceAlerts] = useState<VoiceAlert[]>([]);
  const [liveAlert, setLiveAlert] = useState<VoiceAlert | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const trackingRef = useRef<{ face: FaceDetector; pose: PoseLandmarker; hands: HandLandmarker } | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const trackingBusyRef = useRef(false);
  const lastTrackingTimeRef = useRef(0);
  const faceRecognitionStatusRef = useRef<'unavailable' | 'searching' | 'detected'>('unavailable');
  const poseLandmarksRef = useRef<LandmarkPoint[]>([]);
  const handLandmarksRef = useRef<LandmarkPoint[][]>([]);
  const transcriptRef = useRef('');
  const elapsedRef = useRef(0);
  const reviewMarkersRef = useRef<ReviewMarker[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const silenceStartedRef = useRef<number | null>(null);
  const lastPauseMarkerRef = useRef(-10);
  const prevFrameAtRef = useRef(0);
  const processedSpeechResultsRef = useRef(0);
  const monitorRef = useRef<RealtimeVoiceMonitor | null>(null);
  const monitorAnalyserRef = useRef<AnalyserNode | null>(null);
  // `getFloatTimeDomainData` requires a non-shared backing buffer.
  const monitorFrameRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const monitorSnapshotAtRef = useRef(0);
  const monitorAudioClockRef = useRef(-1);

  useEffect(() => {
    const savedName = window.localStorage.getItem('fusion-coach.identity');
    if (savedName) {
      setIdentityName(savedName);
      setAuthStep('signed-in');
    }
  }, []);

  useEffect(() => {
    activeRef.current = active && !paused;
  }, [active, paused]);

  useEffect(() => {
    faceRecognitionStatusRef.current = faceRecognitionStatus;
  }, [faceRecognitionStatus]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    if (!active || paused) return;
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, paused]);

  useEffect(() => {
    if (!liveAlert) return;
    const timer = window.setTimeout(() => setLiveAlert(null), ALERT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [liveAlert]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => undefined);
      startTracking();
    } else {
      stopTracking();
    }
  }, [cameraEnabled]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (audioFrameRef.current) window.cancelAnimationFrame(audioFrameRef.current);
    if (trackingFrameRef.current) window.cancelAnimationFrame(trackingFrameRef.current);
    void audioContextRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, []);

  const startTracking = () => {
    stopTracking();
    if (!videoRef.current) {
      setFaceRecognitionStatus('unavailable');
      setPoseStatus('unavailable');
      setHandStatus('unavailable');
      return;
    }
    setFaceRecognitionStatus('searching');
    setPoseStatus('loading');
    setHandStatus('loading');
    void (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
        );
        const [face, pose, hands] = await Promise.all([
          FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.5,
          }),
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
          }),
          HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
          }),
        ]);
        trackingRef.current = { face, pose, hands };
        setPoseStatus('ready');
        setHandStatus('ready');

        const detect = () => {
          const video = videoRef.current;
          const trackers = trackingRef.current;
          if (!video || !trackers) return;
          if (video.readyState >= 2 && video.videoWidth > 0 && !trackingBusyRef.current && performance.now() - lastTrackingTimeRef.current > 90) {
            trackingBusyRef.current = true;
            lastTrackingTimeRef.current = performance.now();
            try {
              const timestamp = Math.round(lastTrackingTimeRef.current);
              const faceResult = trackers.face.detectForVideo(video, timestamp);
              const face = faceResult.detections[0]?.boundingBox;
              const keypoints = (faceResult.detections[0]?.keypoints ?? []).map((point) => ({ x: point.x, y: point.y }));
              if (face) {
                setFaceBox({
                  x: 100 - ((face.originX + face.width) / video.videoWidth) * 100,
                  y: (face.originY / video.videoHeight) * 100,
                  width: (face.width / video.videoWidth) * 100,
                  height: (face.height / video.videoHeight) * 100,
                });
                setFaceKeypoints(keypoints);
                setFaceRecognitionStatus('detected');
              } else {
                setFaceBox(null);
                setFaceKeypoints([]);
                setFaceRecognitionStatus('searching');
              }
              const poseResult = trackers.pose.detectForVideo(video, timestamp);
              const nextPoseLandmarks = (poseResult.landmarks[0] ?? []).map((point) => ({ x: point.x, y: point.y, z: point.z, visibility: point.visibility }));
              poseLandmarksRef.current = nextPoseLandmarks;
              setPoseLandmarks(nextPoseLandmarks);
              setPoseStatus(nextPoseLandmarks.length ? 'detected' : 'ready');
              const handResult = trackers.hands.detectForVideo(video, timestamp);
              const nextHandLandmarks = handResult.landmarks.map((landmarks) => landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })));
              handLandmarksRef.current = nextHandLandmarks;
              setHandLandmarks(nextHandLandmarks);
              setHandStatus(nextHandLandmarks.length ? 'detected' : 'ready');
            } catch {
              setFaceBox(null);
              setFaceKeypoints([]);
              setPoseLandmarks([]);
              setHandLandmarks([]);
              setFaceRecognitionStatus('unavailable');
              setPoseStatus('unavailable');
              setHandStatus('unavailable');
            } finally {
              trackingBusyRef.current = false;
            }
          }
          trackingFrameRef.current = window.requestAnimationFrame(detect);
        };
        detect();
      } catch {
        trackingRef.current = null;
        setFaceRecognitionStatus('unavailable');
        setPoseStatus('unavailable');
        setHandStatus('unavailable');
      }
    })();
  };

  const stopTracking = () => {
    if (trackingFrameRef.current) window.cancelAnimationFrame(trackingFrameRef.current);
    trackingFrameRef.current = null;
    trackingRef.current?.face.close();
    trackingRef.current?.pose.close();
    trackingRef.current?.hands.close();
    trackingRef.current = null;
    setPoseStatus('unavailable');
    setHandStatus('unavailable');
    setFaceBox(null);
    setFaceKeypoints([]);
    setPoseLandmarks([]);
    setHandLandmarks([]);
    setFaceRecognitionStatus('unavailable');
  };

  const addReviewMarker = (time: number, label: string, kind: ReviewMarker['kind']) => {
    const nextTime = Math.max(0, Math.round(time * 10) / 10);
    const duplicate = reviewMarkersRef.current.some((marker) => marker.label === label && Math.abs(marker.time - nextTime) < 1.5);
    if (duplicate) return;
    const nextMarker = [...reviewMarkersRef.current, { time: nextTime, label, kind }].sort((a, b) => a.time - b.time);
    reviewMarkersRef.current = nextMarker;
    setReviewMarkers(nextMarker);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') return;
    try {
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        const nextUrl = URL.createObjectURL(blob);
        setRecordingUrl((previousUrl) => {
          if (previousUrl) URL.revokeObjectURL(previousUrl);
          return nextUrl;
        });
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
    } catch {
      mediaRecorderRef.current = null;
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setRecordingDuration(elapsedRef.current);
    recorder.stop();
    mediaRecorderRef.current = null;
  };

  const audioMonitorGenerationRef = useRef(0);

  const startAudioMonitor = (stream: MediaStream) => {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor || stream.getAudioTracks().length === 0) return;
    void audioContextRef.current?.close();
    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    // The realtime monitor needs a longer window than the level meter: pitch
    // autocorrelation is only meaningful from ~43ms of samples upward.
    const monitorAnalyser = context.createAnalyser();
    monitorAnalyser.fftSize = MONITOR_CONFIG.frameSize;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(monitorAnalyser);
    monitorAnalyserRef.current = monitorAnalyser;
    monitorFrameRef.current = new Float32Array(MONITOR_CONFIG.frameSize);
    monitorAudioClockRef.current = -1;
    const data = new Uint8Array(analyser.fftSize);
    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = context;
    // Invalidate any previous sampling loop so exactly one monitor is alive —
    // stale loops kept reading a closed context (frozen level, ghost double-count).
    const generation = ++audioMonitorGenerationRef.current;

    const sample = () => {
      if (audioMonitorGenerationRef.current !== generation) return;
      analyser.getByteTimeDomainData(data);
      const level = Math.sqrt(data.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0) / data.length);
      setAudioLevel(level);
      analyser.getByteFrequencyData(frequencies);
      setFrequencyData(Array.from(frequencies.slice(0, 24)));
      const now = performance.now();
      // Time since the previous audio frame, capped so a stalled tab or long
      // hiccup can never credit more than 0.25s of voice in a single frame.
      const frameDelta = prevFrameAtRef.current > 0
        ? Math.min(0.25, Math.max(0, (now - prevFrameAtRef.current) / 1000))
        : 0;
      prevFrameAtRef.current = now;
      const monitor = monitorRef.current;
      const monitorFrame = monitorFrameRef.current;
      // Credit the monitor with time actually elapsed on the audio clock rather
      // than the analyser window length: this loop can run at any frame rate, so
      // a fixed per-frame duration would fast-forward a throttled or 60fps tab.
      const monitorDelta = monitorAudioClockRef.current >= 0
        ? Math.min(0.25, Math.max(0, context.currentTime - monitorAudioClockRef.current))
        : 0;
      monitorAudioClockRef.current = context.currentTime;
      if (activeRef.current && monitor && monitorFrame && monitorDelta > 0) {
        monitorAnalyser.getFloatTimeDomainData(monitorFrame);
        const raised = monitor.pushFrame(monitorFrame, context.sampleRate, monitorDelta);
        if (raised.length) {
          setVoiceAlerts((current) => [...current, ...raised].slice(-40));
          setLiveAlert(raised[raised.length - 1]);
        }
        if (now - monitorSnapshotAtRef.current > 250) {
          monitorSnapshotAtRef.current = now;
          setMonitorSnapshot(monitor.snapshot());
        }
      }
      if (activeRef.current && level > MIC_ACTIVE_THRESHOLD) {
        if (frameDelta > 0) {
          setSpeechSeconds((current) => current + frameDelta);
        }
        silenceStartedRef.current = null;
      } else if (activeRef.current) {
        silenceStartedRef.current ??= now;
        if (silenceStartedRef.current && now - silenceStartedRef.current > 2500 && elapsedRef.current - lastPauseMarkerRef.current > 8) {
          addReviewMarker(Math.max(0, elapsedRef.current - 1), 'Extended pause', 'issue');
          lastPauseMarkerRef.current = elapsedRef.current;
        }
      }
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
    processedSpeechResultsRef.current = 0;
    recognition.onresult = (event) => {
      const finalText: string[] = [];
      for (let index = processedSpeechResultsRef.current; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          finalText.push(event.results[index][0].transcript.trim());
        }
      }
      processedSpeechResultsRef.current = event.results.length;
      const nextTranscript = finalText.join(' ').trim();
      if (nextTranscript) {
        const combinedTranscript = `${transcriptRef.current} ${nextTranscript}`.trim();
        transcriptRef.current = combinedTranscript;
        setTranscript(combinedTranscript);
        setSpeechWords(combinedTranscript.split(/\s+/).filter(Boolean).length);
        if (!reviewMarkersRef.current.some((marker) => marker.label === 'Speech captured')) {
          addReviewMarker(elapsedRef.current, 'Speech captured', 'good');
        }
        if (/\b(\w+)\s+\1\b/i.test(nextTranscript)) {
          addReviewMarker(elapsedRef.current, 'Repeated word / possible stutter', 'issue');
        }
        if (/\b(um+|uh+|er+)\b/i.test(nextTranscript)) {
          addReviewMarker(elapsedRef.current, 'Filler or hesitation', 'issue');
        }
      }
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
      setNotice('Camera and microphone are connected. Audio and video stay on this device; only the finished transcript is sent for scoring.');
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
      stopRecording();
      setCompleted(true);
      const sessionSeconds = Math.max(1, elapsed);
      const unmet: string[] = [];
      if (!cameraEnabled) unmet.push('camera signal');
      if (!micEnabled) unmet.push('microphone signal');
      if (speechWords < MIN_SPEECH_WORDS) unmet.push(`at least ${MIN_SPEECH_WORDS} words (captured ${speechWords})`);
      if (speechSeconds < MIN_SPEECH_SECONDS) unmet.push(`at least ${MIN_SPEECH_SECONDS}s of voice (captured ${Math.round(speechSeconds)}s)`);
      if (elapsed < MIN_SESSION_SECONDS) unmet.push(`a ${MIN_SESSION_SECONDS}s session (lasted ${formatTime(elapsed)})`);
      const hasEvidence = unmet.length === 0;
      const issueCount = reviewMarkersRef.current.filter((marker) => marker.kind === 'issue').length;
      const componentScores = [
        cameraEnabled ? 1 : 0,
        micEnabled ? 1 : 0,
        Math.min(1, speechWords / MIN_SPEECH_WORDS),
        Math.min(1, speechSeconds / MIN_SPEECH_SECONDS),
        Math.min(1, elapsed / MIN_SESSION_SECONDS),
      ];
      const baseScore = Math.round((componentScores.reduce((total, value) => total + value, 0) / componentScores.length) * 100);
      const hesitationsPerMinute = issueCount / (sessionSeconds / 60);
      const hesitationDeduction = Math.min(20, Math.round(hesitationsPerMinute * 6));
      const evidenceScore = hasEvidence
        ? Math.max(0, Math.min(100, baseScore - hesitationDeduction))
        : null;
      setScoreBreakdown({
        base: baseScore,
        issueDeduction: hesitationDeduction,
        final: evidenceScore ?? 0,
        reason: hesitationDeduction
          ? `${issueCount} hesitation${issueCount === 1 ? '' : 's'} detected — about ${hesitationsPerMinute.toFixed(1)} per minute of speech`
          : 'No repeated words, filler events, or extended pauses detected in your speech',
        unmet,
        wordRate: Math.round((speechWords / Math.max(1, speechSeconds)) * 60),
        scored: hasEvidence,
      });
      setScore(evidenceScore);
      setDelivery({ status: 'loading' });
      void requestDeliveryRead(transcriptRef.current, speechSeconds).then(setDelivery);
      const monitor = monitorRef.current;
      monitor?.stop();
      setVoiceSummary(monitor?.getSummary() ?? null);
      setMonitorSnapshot(monitor?.snapshot() ?? null);
      setLiveAlert(null);
      const newItem: HistoryItem = {
        id: `session-${Date.now()}`,
        title: 'Focused communication practice',
        date: 'Just now',
        duration: formatTime(elapsed),
        score: evidenceScore,
        label: evidenceScore === null ? 'Below threshold' : evidenceScore >= 80 ? 'Strong sample' : 'Scored',
      };
      setHistory((items) => [newItem, ...items].slice(0, 4));
      setNotice(hasEvidence
        ? `Session complete — scored ${evidenceScore}/100 from ${speechWords} words, ${Math.round(speechSeconds)}s of voice, and ${formatTime(elapsed)} of session time.`
        : `No score this round — missing ${joinList(unmet)}. Speak for most of the session and the score will appear.`);
      return;
    }
    if (!cameraEnabled || !micEnabled) {
      setNotice('It’s quiet right now — connect both camera and microphone before starting an evaluation.');
      return;
    }
    setCompleted(false);
    setElapsed(0);
    setScore(null);
    setScoreBreakdown(null);
    setDelivery(null);
    setSpeechWords(0);
    setSpeechSeconds(0);
    setTranscript('');
    transcriptRef.current = '';
    setReviewMarkers([]);
    reviewMarkersRef.current = [];
    setRecordingDuration(0);
    silenceStartedRef.current = null;
    lastPauseMarkerRef.current = -10;
    prevFrameAtRef.current = 0;
    setFrequencyData(Array.from({ length: 24 }, () => 0));
    setPaused(false);
    const monitor = new RealtimeVoiceMonitor();
    monitor.start();
    monitorRef.current = monitor;
    monitorSnapshotAtRef.current = 0;
    monitorAudioClockRef.current = -1;
    setMonitorSnapshot(monitor.snapshot());
    setVoiceSummary(null);
    setVoiceAlerts([]);
    setLiveAlert(null);
    setActive(true);
    activeRef.current = true;
    startSpeechCapture();
    startRecording();
    setNotice(`Session is live. Fill the readiness dial — ${MIN_SPEECH_WORDS}+ words, ${MIN_SPEECH_SECONDS}s+ of voice, ${MIN_SESSION_SECONDS}s+ of session — then finish for your score.`);
  };

  const handleNav = (label: string) => {
    setActiveNav(label);
    setNotice('');
  };

  const restartAssessment = () => {
    setActive(false);
    activeRef.current = false;
    stopSpeechCapture();
    setPaused(false);
    setCompleted(false);
    setElapsed(0);
    setScore(null);
    setDelivery(null);
    setSpeechWords(0);
    setSpeechSeconds(0);
    setTranscript('');
    setFaceBox(null);
    monitorRef.current?.reset();
    monitorRef.current = null;
    setMonitorSnapshot(null);
    setVoiceSummary(null);
    setVoiceAlerts([]);
    setLiveAlert(null);
    setNotice('Assessment restarted. The score will stay empty until real signals are captured.');
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
      } else if (event.key === '1') setOverlay('human-eye');
      else if (event.key === '2') setOverlay('ai');
      else if (event.key === '3') setOverlay('tracking');
      else if (event.key.toLowerCase() === 't') setOverlay('transcript');
      else if (event.key.toLowerCase() === 'f') setOverlay('frequency');
      else if (event.key.toLowerCase() === 's') setOverlay('scores');
      else if (event.key.toLowerCase() === 'h') setShortcutsOpen(true);
      else if (event.key.toLowerCase() === 'r') restartAssessment();
      else if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaused((current) => {
          const next = !current;
          activeRef.current = active && !next;
          if (next) stopSpeechCapture();
          else if (active) startSpeechCapture();
          return next;
        });
      } else if (event.key.toLowerCase() === 'd') {
        setOverlay(null);
        handleNav('Practice room');
      }
      else if (event.key === 'Escape') {
        setOverlay(null);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const readiness = {
    camera: cameraEnabled,
    mic: micEnabled && audioLevel > MIC_ACTIVE_THRESHOLD,
    words: Math.min(1, speechWords / MIN_SPEECH_WORDS),
    voice: Math.min(1, speechSeconds / MIN_SPEECH_SECONDS),
    duration: Math.min(1, elapsed / MIN_SESSION_SECONDS),
  };
  const readinessPct = Math.round(((readiness.words + readiness.voice + readiness.duration + (readiness.camera ? 1 : 0) + (readiness.mic ? 1 : 0)) / 5) * 100);
  const ringValue = active ? readinessPct : score;
  const ringStyle = active || score !== null
    ? ({ background: `conic-gradient(#c3df39 0deg ${(ringValue ?? 0) * 3.6}deg, #ece7dd ${(ringValue ?? 0) * 3.6}deg 360deg)` } as CSSProperties)
    : undefined;
  const activeStageIndex = active || completed ? 5 : 1;
  const statusLabel = active ? 'Live session' : completed ? 'Session complete' : 'Ready for practice';
  const speechSupported = Boolean((window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
    ?? (window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  if (authStep !== 'signed-in') {
    return (
      <AuthGate
        step={authStep}
        name={nameDraft}
        onNameChange={setNameDraft}
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
            <button className={`fc-nav-item ${activeNav === 'Voice lab' ? 'active' : ''}`} onClick={() => handleNav('Voice lab')} data-testid="nav-voice-lab">
              <Mic /> <span>Voice lab</span>
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
             <button className={`fc-user ${accountMenuOpen ? 'open' : ''}`} onClick={() => setAccountMenuOpen((open) => !open)} data-testid="user-profile" aria-expanded={accountMenuOpen}>
              <div className="fc-avatar">{identityName.slice(0, 2).toUpperCase()}</div>
              <div className="fc-user-text"><b>{identityName}</b><span>Private practice</span></div>
              <MoreHorizontal size={16} color="#858a96" />
             </button>
             {accountMenuOpen && <div className="fc-account-menu" role="menu">
               <button onClick={() => { setAccountMenuOpen(false); handleNav('Settings'); }} role="menuitem"><Settings2 size={14} /> Account settings</button>
               <button onClick={() => { setAccountMenuOpen(false); signOut(); }} role="menuitem"><LogOut size={14} /> Sign out</button>
             </div>}
          </div>
        </aside>

        <main className="fc-main">
          <header className="fc-header">
            <div>
              <div className="fc-eyebrow">{formatToday()}</div>
              <h2 className="fc-greeting" data-testid="text-greeting">Good morning, {identityName}</h2>
            </div>
            <div className="fc-header-actions">
              <button className="fc-icon-button fc-mobile-menu" onClick={() => setNotice('Use the workspace tabs on the left to move around Fusion Coach.')} aria-label="Open workspace navigation" data-testid="button-mobile-menu"><LayoutDashboard size={17} /></button>
              <button className="fc-icon-button" onClick={() => setNotice('Your practice data is stored locally in this demo workspace.')} aria-label="Privacy information" data-testid="button-privacy"><Sparkles size={17} /></button>
              <button className="fc-icon-button" onClick={() => setShortcutsOpen(true)} aria-label="Open keyboard shortcuts" data-testid="button-shortcuts"><Keyboard size={17} /></button>
              <button className="fc-icon-button" onClick={() => handleNav('Settings')} aria-label="Open settings" data-testid="button-settings"><Settings2 size={17} /></button>
            </div>
          </header>

          <div className="fc-main-inner">
            {activeNav === 'Voice lab' && <VoiceLab />}
            {activeNav !== 'Practice room' && activeNav !== 'Voice lab' && (
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
                 {overlay && (
                   <InspectorOverlay
                     view={overlay}
                     stream={streamRef.current}
                     transcript={transcript}
                     frequencyData={frequencyData}
                     audioLevel={audioLevel}
                     speechWords={speechWords}
                     speechSeconds={speechSeconds}
                     score={score}
                     cameraEnabled={cameraEnabled}
                     micEnabled={micEnabled}
                     faceBox={faceBox}
                     faceKeypoints={faceKeypoints}
                     poseLandmarks={poseLandmarks}
                     handLandmarks={handLandmarks}
                     faceRecognitionStatus={faceRecognitionStatus}
                     poseStatus={poseStatus}
                     handStatus={handStatus}
                   />
                 )}
              </section>

              <section className="fc-card fc-score-card" aria-labelledby="score-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="score-title">Live score</h3><span className="fc-card-meta">Fusion readout</span></div><button className="fc-icon-button" onClick={() => handleNav('Progress')} aria-label="View progress"><ArrowUpRight size={17} /></button></div>
                <div className="fc-score-body">
                  <div className={`fc-score-ring ${active || score !== null ? '' : 'empty'}`} style={ringStyle} data-testid="score-ring"><div className="fc-score-number"><strong data-testid="text-live-score">{active ? `${readinessPct}%` : score ?? '—'}</strong><span>{active ? 'session readiness' : score !== null ? 'final score' : 'not scored'}</span></div></div>
                  <div className="fc-score-copy">
                    <h3>{active ? (readinessPct >= 100 ? 'All requirements met — finish for your score.' : 'Evidence is accumulating.') : completed ? (score !== null ? 'Evidence-based round.' : 'Not enough evidence this round.') : 'No score yet.'}</h3>
                    <p>{active
                      ? `The engine is listening. Reach ${MIN_SPEECH_WORDS}+ words, ${MIN_SPEECH_SECONDS}s+ of voice, and ${MIN_SESSION_SECONDS}s+ of session to earn a score.`
                      : `A score appears only after ${MIN_SPEECH_WORDS}+ words, ${MIN_SPEECH_SECONDS}s+ of voice, and ${MIN_SESSION_SECONDS}s+ of session. Silence never earns a score.`}</p>
                    <div className="fc-score-trend"><Info /> {speechWords}/{MIN_SPEECH_WORDS} words · {Math.round(speechSeconds)}/{MIN_SPEECH_SECONDS}s voice · {formatTime(elapsed)} elapsed</div>
                  </div>
                </div>
                <div className="fc-divider" />
                <div className="fc-requirements" data-testid="requirements-list">
                  {[
                    { id: 'camera', ok: cameraEnabled, text: 'Camera connected' },
                    { id: 'mic', ok: readiness.mic, text: readiness.mic ? 'Hearing you clearly' : micEnabled ? 'Mic connected — waiting for your voice' : 'Microphone connected' },
                    { id: 'words', ok: speechWords >= MIN_SPEECH_WORDS, text: `${MIN_SPEECH_WORDS}+ words spoken (${speechWords} so far)` },
                    { id: 'voice', ok: speechSeconds >= MIN_SPEECH_SECONDS, text: `${MIN_SPEECH_SECONDS}s+ of voice activity (${Math.round(speechSeconds)}s so far)` },
                    { id: 'length', ok: elapsed >= MIN_SESSION_SECONDS, text: `${MIN_SESSION_SECONDS}s+ session length (${formatTime(elapsed)} so far)` },
                  ].map((req) => (
                    <div className={`fc-requirement ${req.ok ? 'met' : ''}`} key={req.id}>
                      {req.ok ? <CheckCircle2 size={13} /> : <Target size={13} />}
                      <span>{req.text}</span>
                    </div>
                  ))}
                </div>
                <VoiceControlPanel
                  snapshot={monitorSnapshot}
                  summary={voiceSummary}
                  alerts={voiceAlerts}
                  liveAlert={liveAlert}
                  active={active}
                />
                <DeliveryReadout delivery={delivery} />
              </section>
            </div>

            <div className="fc-bottom-grid">
              <section className="fc-card fc-feedback" aria-labelledby="feedback-title">
                <div className="fc-card-head"><div><h3 className="fc-card-title" id="feedback-title">Coach’s read</h3><span className="fc-card-meta">Specific, not noisy</span></div><Headphones size={17} color="#9ba0a7" /></div>
                <div className="fc-feedback-list">
                  <Feedback icon={<Camera size={14} />} title={cameraEnabled ? 'Camera signal connected' : 'It’s quiet right now'} text={cameraEnabled ? 'The camera is connected. Face, body, and hand landmarks are drawn only when the live models return them.' : 'No camera signal is connected. Turn on the camera before asking for a presence evaluation.'} />
                  <Feedback icon={<AudioLines size={14} />} title={micEnabled && audioLevel > MIC_ACTIVE_THRESHOLD ? 'Voice activity detected' : 'No speech captured yet'} text={speechSupported ? 'The browser speech engine counts final words. Speak a complete thought so the score has evidence to use.' : 'This browser does not expose speech-to-text. The microphone can still show activity, but no word-level evaluation is available.'} />
                  <Feedback icon={<Info size={14} />} title="How the evaluation works" text={`A session is scored once it captures ${MIN_SPEECH_WORDS}+ words, ${MIN_SPEECH_SECONDS}+ seconds of voice, and ${MIN_SESSION_SECONDS}+ seconds of session time. Short or silent rounds stay unscored — they never default to a passing number.`} />
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
             <ReviewPanel
               recordingUrl={recordingUrl}
               recordingDuration={recordingDuration}
               markers={reviewMarkers}
               score={score}
               breakdown={scoreBreakdown}
               voiceSummary={voiceSummary}
               voiceAlerts={voiceAlerts}
             />
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
};

function WorkspaceView({ activeNav, history, identityName, onNameChange, onSignOut, onOpenShortcuts }: WorkspaceViewProps) {
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
            <div><b>03 / Speech sample</b><span>At least {MIN_SPEECH_WORDS} final words from the browser speech engine.</span></div>
            <div><b>04 / Session duration</b><span>A score requires {MIN_SESSION_SECONDS}s+ of session and {MIN_SPEECH_SECONDS}s+ of voice — silence never scores.</span></div>
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

function AuthGate({ step, name, onNameChange, onNewAccount, onGuest, onSubmitName, onBack }: {
  step: AuthStep;
  name: string;
  onNameChange: (name: string) => void;
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
          <p className="fc-auth-copy">Create a new practice identity, or evaluate as a guest without saving anything.</p>
          <div className="fc-auth-options">
            <button className="fc-auth-option" onClick={onNewAccount}><span className="fc-auth-icon"><UserPlus size={19} /></span><span><b>Create a new account</b><small>Choose a name for your practice space</small></span><ChevronRight size={16} /></button>
            <button className="fc-auth-option" onClick={onGuest}><span className="fc-auth-icon"><Users size={19} /></span><span><b>Guest evaluation</b><small>Try the room without saving an account</small></span><ChevronRight size={16} /></button>
          </div>
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

function InspectorOverlay({ view, stream, transcript, frequencyData, audioLevel, speechWords, speechSeconds, score, cameraEnabled, micEnabled, faceBox, faceKeypoints, poseLandmarks, handLandmarks, faceRecognitionStatus, poseStatus, handStatus, onClose }: {
  view: OverlayView;
  stream: MediaStream | null;
  transcript: string;
  frequencyData: number[];
  audioLevel: number;
  speechWords: number;
  speechSeconds: number;
  score: number | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  faceBox: FaceBox | null;
  faceKeypoints: LandmarkPoint[];
  poseLandmarks: LandmarkPoint[];
  handLandmarks: LandmarkPoint[][];
  faceRecognitionStatus: 'unavailable' | 'searching' | 'detected';
  poseStatus: TrackerStatus;
  handStatus: TrackerStatus;
  onClose?: () => void;
}) {
  const titles: Record<OverlayView, { eyebrow: string; title: string; description: string }> = {
    'human-eye': { eyebrow: '01 / Human eye view', title: 'Raw camera signal', description: 'This is the unprocessed camera view. No score is inferred here.' },
    ai: { eyebrow: '02 / AI view', title: 'Multimodal analysis', description: 'Every line below is labeled by what the browser can actually observe.' },
    tracking: { eyebrow: '03 / AI tracking view', title: 'Tracking transparency', description: 'The overlay shows detected geometry when a browser detector is available.' },
    transcript: { eyebrow: 'T / Transcript', title: 'Speech to text', description: 'Only final browser speech results are counted toward the sample.' },
    frequency: { eyebrow: 'F / Frequency / audio', title: 'Audio frequency', description: 'Live microphone amplitude and frequency bins from the connected input.' },
    scores: { eyebrow: 'S / Scores', title: 'Evidence and scores', description: 'Scores stay empty until the assessment has enough real input.' },
  };
  const header = titles[view];

  return (
    <section className="fc-inline-analysis" aria-labelledby="inspector-title">
      <div className="fc-inspector-head">
        <div><div className="fc-kicker">{header.eyebrow}</div><h2 id="inspector-title">{header.title}</h2><p>{header.description}</p></div>
        {onClose && <button className="fc-icon-button" onClick={onClose} aria-label="Close active analysis"><X size={17} /></button>}
      </div>

        {view === 'human-eye' && (
          <div className="fc-inspector-video-wrap">
            <CameraSignalPreview stream={stream} cameraEnabled={cameraEnabled} faceBox={faceBox} faceKeypoints={faceKeypoints} poseLandmarks={poseLandmarks} handLandmarks={handLandmarks} />
            <span className="fc-inspector-tag">RAW / HUMAN EYE + LIVE LANDMARKS</span>
          </div>
        )}

        {view === 'ai' && (
          <div className="fc-ai-analysis">
            <div className="fc-ai-camera">
              <CameraSignalPreview stream={stream} cameraEnabled={cameraEnabled} faceBox={faceBox} faceKeypoints={faceKeypoints} poseLandmarks={poseLandmarks} handLandmarks={handLandmarks} />
            </div>
            <div className="fc-signal-table">
              <SignalRow label="Camera input" value={cameraEnabled ? 'Connected' : 'Not connected'} detail={cameraEnabled ? 'Live frames are visible in this panel' : 'No visual evidence'} tone={cameraEnabled ? 'good' : 'quiet'} />
              <SignalRow label="Face presence" value={faceRecognitionStatus === 'detected' ? 'Face detected' : faceRecognitionStatus === 'searching' ? 'Searching' : 'Detector unavailable'} detail={faceBox ? `x ${Math.round(faceBox.x)}% · y ${Math.round(faceBox.y)}%` : 'No location returned'} tone={faceRecognitionStatus === 'detected' ? 'good' : 'quiet'} />
              <SignalRow label="Microphone input" value={micEnabled ? 'Connected' : 'Not connected'} detail={`${Math.round(audioLevel * 100)}% current amplitude`} tone={micEnabled ? 'good' : 'quiet'} />
              <SignalRow label="Speech to text" value={speechWords > 0 ? `${speechWords} words` : 'Waiting'} detail={transcript || 'No final transcript yet'} tone={speechWords > 0 ? 'good' : 'quiet'} />
              <SignalRow label="Body / pose" value={trackingStatusLabel(poseStatus)} detail={trackingStatusDetail(poseStatus, 'body landmarks')} tone={poseStatus === 'detected' ? 'good' : 'quiet'} />
              <SignalRow label="Hands" value={trackingStatusLabel(handStatus)} detail={trackingStatusDetail(handStatus, 'hand landmarks')} tone={handStatus === 'detected' ? 'good' : 'quiet'} />
            </div>
          </div>
        )}

        {view === 'tracking' && (
          <div className="fc-tracking-view">
            <div className="fc-tracking-canvas">
              <CameraSignalPreview stream={stream} cameraEnabled={cameraEnabled} faceBox={faceBox} faceKeypoints={faceKeypoints} poseLandmarks={poseLandmarks} handLandmarks={handLandmarks} />
              <div className="fc-tracking-label">{faceRecognitionStatus === 'detected' ? 'FACE LANDMARK SOURCE / MEDIAPIPE' : faceRecognitionStatus === 'searching' ? 'LOADING OR SEARCHING FOR FACE' : 'FACE MODEL UNAVAILABLE'}</div>
            </div>
            <div className="fc-tracking-readout">
              <SignalRow label="Face" value={faceRecognitionStatus === 'detected' ? 'Located' : 'Not located'} detail={faceBox ? `x ${Math.round(faceBox.x)}% · y ${Math.round(faceBox.y)}% · ${Math.round(faceBox.width)}% × ${Math.round(faceBox.height)}%` : 'No bounding box available'} tone={faceRecognitionStatus === 'detected' ? 'good' : 'quiet'} />
              <SignalRow label="Body / pose" value={trackingStatusLabel(poseStatus)} detail={trackingStatusDetail(poseStatus, 'body landmarks')} tone={poseStatus === 'detected' ? 'good' : 'quiet'} />
              <SignalRow label="Hands" value={trackingStatusLabel(handStatus)} detail={trackingStatusDetail(handStatus, 'hand landmarks')} tone={handStatus === 'detected' ? 'good' : 'quiet'} />
            </div>
          </div>
        )}

        {(view === 'transcript' || view === 'frequency') && (
          <div className="fc-telemetry-grid">
            <div className="fc-transcript-panel">
              <div className="fc-transcript-meta"><span>{speechWords} words captured</span><span>{Math.round(speechSeconds)}s voice activity</span></div>
              <p>{transcript || 'No speech to text yet. Start an assessment and speak a complete thought.'}</p>
              <div className="fc-transcript-note"><Info size={14} /> Transcript and audio stay together under the camera feed.</div>
            </div>
            <div className="fc-frequency-panel">
              <div className="fc-frequency-visual" aria-label="Live audio frequency visualization">{frequencyData.map((value, index) => <i key={index} style={{ height: `${Math.max(5, value / 2)}%` }} />)}</div>
              <div className="fc-frequency-meta"><span>Amplitude <b>{Math.round(audioLevel * 100)}%</b></span><span>Microphone <b>{micEnabled ? 'connected' : 'off'}</b></span></div>
            </div>
          </div>
        )}

        {view === 'scores' && (
          <div className="fc-score-inspector">
            <div className="fc-evidence-score"><strong>{score ?? '—'}</strong><span>{score === null ? 'not scored' : 'signal coverage'}</span></div>
            <div className="fc-signal-table">
              <SignalRow label="Speech words" value={String(speechWords)} detail="Final words from browser speech-to-text" tone={speechWords > 0 ? 'good' : 'quiet'} />
              <SignalRow label="Voice activity" value={`${Math.round(speechSeconds)}s`} detail="Microphone amplitude above the activity threshold" tone={speechSeconds > 0 ? 'good' : 'quiet'} />
              <SignalRow label="Face location" value={faceBox ? 'Available' : 'Unavailable'} detail={faceBox ? 'Bounding box returned by browser detector' : 'No face coordinates available'} tone={faceBox ? 'good' : 'quiet'} />
            </div>
          </div>
        )}
    </section>
  );
}

const poseConnections: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [28, 30],
  [29, 31], [30, 32],
];

const handConnections: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function CameraSignalPreview({ stream, cameraEnabled, faceBox, faceKeypoints, poseLandmarks, handLandmarks }: {
  stream: MediaStream | null;
  cameraEnabled: boolean;
  faceBox: FaceBox | null;
  faceKeypoints: LandmarkPoint[];
  poseLandmarks: LandmarkPoint[];
  handLandmarks: LandmarkPoint[][];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || !cameraEnabled) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream, cameraEnabled]);

  return (
    <div className="fc-signal-preview">
      {stream && cameraEnabled ? (
        <>
          <video ref={videoRef} className="fc-inspector-video" autoPlay muted playsInline aria-label="Live camera with tracking landmarks" />
          <LandmarkOverlay faceBox={faceBox} faceKeypoints={faceKeypoints} poseLandmarks={poseLandmarks} handLandmarks={handLandmarks} />
        </>
      ) : (
        <div className="fc-inspector-empty"><VideoOff size={26} /><span>Turn on the camera to see the live signal</span></div>
      )}
    </div>
  );
}

function LandmarkOverlay({ faceBox, faceKeypoints, poseLandmarks, handLandmarks }: {
  faceBox: FaceBox | null;
  faceKeypoints: LandmarkPoint[];
  poseLandmarks: LandmarkPoint[];
  handLandmarks: LandmarkPoint[][];
}) {
  const point = (landmarks: LandmarkPoint[], index: number) => landmarks[index];
  const coords = (landmark: LandmarkPoint | undefined) => landmark ? { x: 100 - landmark.x * 100, y: landmark.y * 100 } : null;
  const drawConnections = (landmarks: LandmarkPoint[], connections: Array<[number, number]>, color: string) => connections.map(([from, to], index) => {
    const start = coords(point(landmarks, from));
    const end = coords(point(landmarks, to));
    return start && end ? <line key={`${color}-${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth=".45" vectorEffect="non-scaling-stroke" /> : null;
  });

  return (
    <div className="fc-landmark-layer" aria-label="Face, body, and hand landmarks">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {faceBox && <rect x={faceBox.x} y={faceBox.y} width={faceBox.width} height={faceBox.height} fill="none" stroke="#c3df39" strokeWidth=".55" vectorEffect="non-scaling-stroke" />}
        {drawConnections(poseLandmarks, poseConnections, '#7ee0d0')}
        {handLandmarks.map((hand, handIndex) => <g key={`hand-${handIndex}`}>{drawConnections(hand, handConnections, '#ffbf69')}</g>)}
        {faceKeypoints.map((landmark, index) => {
          const position = coords(landmark);
          return position ? <circle key={`face-point-${index}`} cx={position.x} cy={position.y} r=".8" fill="#c3df39" /> : null;
        })}
        {poseLandmarks.map((landmark, index) => {
          const position = coords(landmark);
          return position ? <circle key={`pose-point-${index}`} cx={position.x} cy={position.y} r=".9" fill="#7ee0d0" /> : null;
        })}
        {handLandmarks.flatMap((hand, handIndex) => hand.map((landmark, index) => {
          const position = coords(landmark);
          return position ? <circle key={`hand-point-${handIndex}-${index}`} cx={position.x} cy={position.y} r="1" fill="#ffbf69" /> : null;
        }))}
      </svg>
      <div className="fc-landmark-legend"><span><i className="face" /> Face</span><span><i className="body" /> Body</span><span><i className="hands" /> Hands</span></div>
    </div>
  );
}

function scoreTone(value: number) {
  if (value >= 85) return 'good';
  if (value >= 60) return 'watch';
  return 'low';
}

/**
 * Live readout of the realtime voice monitor: calibration progress, the three
 * baseline-relative monitors, and the most recent drift alert.
 */
function VoiceControlPanel({ snapshot, summary, alerts, liveAlert, active }: {
  snapshot: MonitorSnapshot | null;
  summary: VoiceSummary | null;
  alerts: VoiceAlert[];
  liveAlert: VoiceAlert | null;
  active: boolean;
}) {
  const phase = snapshot?.phase ?? 'idle';
  const calibrating = phase === 'calibrating';
  const calibrated = phase === 'monitoring' || phase === 'stopped';
  const read = summary ?? snapshot?.summary ?? null;
  const hasSpeech = (read?.speechBlocks ?? 0) > 0;
  const calibrationProgress = snapshot
    ? Math.min(100, (snapshot.calibrationElapsed / MONITOR_CONFIG.calibrationSeconds) * 100)
    : 0;
  const monitors = [
    {
      key: 'pitch',
      label: 'Pitch control',
      score: read?.pitchScore ?? 0,
      measured: Boolean(read?.measured.pitch),
      detail: read?.measured.pitch
        ? `${Math.round(read.pitchViolationRatio * 100)}% of speech blocks outside your range`
        : 'No voiced pitch measured yet',
    },
    {
      key: 'energy',
      label: 'Volume control',
      score: read?.energyScore ?? 0,
      measured: Boolean(read?.measured.energy),
      detail: read?.measured.energy
        ? `${Math.round(read.energyViolationRatio * 100)}% of speech blocks outside your level`
        : 'No stable level measured yet',
    },
    {
      key: 'pause',
      label: 'Pause control',
      score: read?.pauseScore ?? 0,
      measured: Boolean(read?.measured.pause) && hasSpeech,
      detail: read?.measured.pause && hasSpeech
        ? `${read.pauseExcessRatio.toFixed(2)}s over the pause threshold per second`
        : 'No pauses measured yet',
    },
  ];

  return (
    <div className={`fc-voice ${active ? 'live' : ''}`} data-testid="voice-control-panel">
      <div className="fc-voice-head">
        <b>Voice control</b>
        <span>{calibrating ? 'Calibrating' : calibrated ? 'Own-baseline monitor' : 'Realtime monitor'}</span>
      </div>

      {calibrating && (
        <div className="fc-voice-calibration" data-testid="voice-calibration">
          <div className="fc-voice-progress"><i style={{ width: `${calibrationProgress}%` }} /></div>
          <div className="fc-voice-progress-meta">
            <span>Recording your baseline — speak naturally</span>
            <b>{(snapshot?.calibrationElapsed ?? 0).toFixed(1)} / {MONITOR_CONFIG.calibrationSeconds.toFixed(1)}s</b>
          </div>
        </div>
      )}

      {calibrated && (
        <>
          <div className="fc-voice-monitors">
            {monitors.map((monitor) => (
              <div className="fc-voice-monitor" key={monitor.key}>
                <div className="fc-voice-monitor-top">
                  <span>{monitor.label}</span>
                  <b className={monitor.measured ? scoreTone(monitor.score) : 'empty'}>
                    {monitor.measured ? Math.round(monitor.score) : '—'}
                  </b>
                </div>
                <div className="fc-voice-bar">
                  <i className={monitor.measured ? scoreTone(monitor.score) : ''} style={{ width: `${monitor.measured ? monitor.score : 0}%` }} />
                </div>
                <small>{monitor.detail}</small>
              </div>
            ))}
          </div>
          <div className="fc-voice-baseline">
            {snapshot && snapshot.baseline.pitchMean !== null && snapshot.baseline.energyMean !== null ? (
              <>
                Baseline pitch {snapshot.baseline.pitchMean.toFixed(1)} st (±{snapshot.baseline.pitchDeviation?.toFixed(2)}) · level{' '}
                {snapshot.baseline.energyMean.toFixed(1)} dB (±{snapshot.baseline.energyDeviation?.toFixed(2)}) · pause threshold{' '}
                {snapshot.baseline.pauseThreshold.toFixed(1)}s
              </>
            ) : (
              <>
                Baseline recorded but too short to model — thresholds fall back to the defaults (|z| {MONITOR_CONFIG.zHigh}, {MONITOR_CONFIG.fallbackPauseThreshold.toFixed(1)}s pause).
              </>
            )}
          </div>
          {hasSpeech && (
            <div className="fc-voice-overall">
              <span>Overall voice control</span>
              <strong>{Math.round(read?.overallScore ?? 0)}</strong>
              <small>mean of the measured monitors</small>
            </div>
          )}
        </>
      )}

      {liveAlert && (
        <div className="fc-voice-alert" role="status" data-testid="voice-alert">
          <Waves size={14} />
          <span><b>{formatTime(Math.round(liveAlert.at))}</b> {liveAlert.message}</span>
        </div>
      )}

      {phase === 'idle' && (
        <p className="fc-voice-note">
          Each session opens with {MONITOR_CONFIG.calibrationSeconds}s of baseline recording. After that every{' '}
          {MONITOR_CONFIG.blockSeconds}s block is compared with your own pitch and volume, and pauses longer than the
          threshold are counted. Alerts repeat at most once every {MONITOR_CONFIG.alertCooldownSeconds}s.
        </p>
      )}

      {calibrated && (
        <p className="fc-voice-note">
          {alerts.length
            ? `${alerts.length} drift alert${alerts.length === 1 ? '' : 's'} so far — these describe distance from your own baseline, not a judgement of how you sound.`
            : 'No drift alerts yet — your pitch, volume, and pauses stay close to your baseline.'}
        </p>
      )}
    </div>
  );
}

function ReviewPanel({ recordingUrl, recordingDuration, markers, score, breakdown, voiceSummary, voiceAlerts }: {
  recordingUrl: string | null;
  recordingDuration: number;
  markers: ReviewMarker[];
  score: number | null;
  breakdown: ScoreBreakdown | null;
  voiceSummary: VoiceSummary | null;
  voiceAlerts: VoiceAlert[];
}) {
  const duration = Math.max(1, recordingDuration);
  return (
    <section className="fc-card fc-review" aria-labelledby="review-title">
      <div className="fc-card-head">
        <div><h3 className="fc-card-title" id="review-title">Last test review</h3><span className="fc-card-meta">Playback with evidence markers</span></div>
        <span className={`fc-review-score ${score === null ? 'empty' : ''}`}>{score ?? '—'}<small>{score === null ? 'not scored' : 'score'}</small></span>
      </div>
      {recordingUrl ? (
        <video className="fc-review-player" src={recordingUrl} controls playsInline preload="metadata" aria-label="Last practice recording" />
      ) : (
        <div className="fc-review-empty"><VideoOff size={18} /><span>Finish a camera-and-microphone session to save its last recording here.</span></div>
      )}
      <div className="fc-review-timeline" style={{ '--review-duration': `${duration}s` } as CSSProperties}>
        <div className="fc-review-track" />
        {markers.map((marker, index) => (
          <div className={`fc-review-marker ${marker.kind}`} style={{ left: `${Math.min(100, (marker.time / duration) * 100)}%` }} key={`${marker.label}-${marker.time}-${index}`}>
            <i />
            <span>{formatTime(Math.round(marker.time))} · {marker.label}</span>
          </div>
        ))}
      </div>
      <div className="fc-review-legend"><span><i className="good" /> Captured clearly</span><span><i className="issue" /> Pause, filler, or repeated word</span></div>
      {breakdown?.scored ? (
        <div className="fc-review-explanation">
          <b>Why this score: {breakdown.final}/100</b>
          <span>Evidence coverage {breakdown.base}/100 − hesitation deduction {breakdown.issueDeduction} · {breakdown.wordRate} words/min.</span>
          <p>{breakdown.reason}. Select a marker above to match the timestamp in the recording.</p>
        </div>
      ) : breakdown ? (
        <div className="fc-review-explanation no-score">
          <b>No score this round</b>
          <span>Missing: {joinList(breakdown.unmet)}.</span>
          <p>Short or silent sessions never earn a default score. Fill the readiness dial — speak for most of the session — and this panel will show the full math.</p>
        </div>
      ) : (
        <div className="fc-review-explanation"><b>No score yet</b><span>Finish a session to see how it was scored.</span></div>
      )}
      <div className="fc-review-events">
        {markers.length ? markers.map((marker, index) => <div className={`fc-review-event ${marker.kind}`} key={`${marker.label}-event-${index}`}><b>{formatTime(Math.round(marker.time))}</b><span>{marker.label}</span></div>) : <span className="fc-review-no-events">No faults detected yet. Speak naturally, then finish the session to review it.</span>}
      </div>
      {voiceSummary && (
        <div className="fc-voice-result" data-testid="voice-result">
          <div className="fc-voice-head"><b>Voice control read</b><span>Own-baseline monitor</span></div>
          {voiceSummary.speechBlocks > 0 ? (
            <>
              <div className="fc-voice-result-grid">
                {([
                  ['Pitch', voiceSummary.pitchScore, voiceSummary.measured.pitch, voiceSummary.pitchViolationRatio],
                  ['Volume', voiceSummary.energyScore, voiceSummary.measured.energy, voiceSummary.energyViolationRatio],
                  ['Pause', voiceSummary.pauseScore, voiceSummary.measured.pause, voiceSummary.pauseExcessRatio],
                ] as const).map(([label, value, measured, ratio]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <b className={measured ? scoreTone(value) : 'empty'}>{measured ? Math.round(value) : '—'}</b>
                    <i className={measured ? scoreTone(value) : ''} style={{ width: `${measured ? value : 0}%` }} />
                    <small>{measured ? `${(ratio * 100).toFixed(0)}% outside baseline` : 'not measured'}</small>
                  </div>
                ))}
              </div>
              <p className="fc-voice-note">
                {voiceSummary.speechBlocks} scored blocks over {Math.round(voiceSummary.evaluationSeconds)}s of evaluation · overall{' '}
                {Math.round(voiceSummary.overallScore)}/100 measured against your own baseline in the first{' '}
                {MONITOR_CONFIG.calibrationSeconds}s of this session.
              </p>
            </>
          ) : voiceSummary.evaluationSeconds === 0 ? (
            <p className="fc-voice-note">
              The session ended before the {MONITOR_CONFIG.calibrationSeconds}s baseline was complete, so the monitor never
              reached its evaluation phase. Nothing is filled in from a partial baseline.
            </p>
          ) : (
            <p className="fc-voice-note">
              No speech blocks reached the monitor, so pitch, volume, and pause control are unmeasured for this round.
              They stay empty instead of defaulting to a score.
            </p>
          )}
          {voiceAlerts.length > 0 && (
            <div className="fc-review-events fc-voice-alert-list">
              {voiceAlerts.map((alert, index) => (
                <div className="fc-review-event issue" key={`${alert.kind}-${alert.at}-${index}`}>
                  <b>{formatTime(Math.round(alert.at))}</b><span>{alert.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DeliveryReadout({ delivery }: { delivery: DeliveryRead | null }) {
  return (
    <div className="fc-delivery" data-testid="delivery-read">
      <div className="fc-delivery-head"><b>Transcript read</b><span>API server</span></div>
      {delivery === null && <p className="fc-delivery-note quiet">Finish a session and the captured transcript is scored for pace, fillers, vocabulary, grammar, and structure.</p>}
      {delivery?.status === 'loading' && <p className="fc-delivery-note quiet">Sending the transcript for analysis…</p>}
      {delivery?.status === 'unavailable' && <p className="fc-delivery-note quiet">{delivery.message}</p>}
      {delivery?.status === 'ready' && (
        <>
          <div className="fc-delivery-metrics">
            <span><b>{delivery.analysis.metrics.wpm}</b> wpm</span>
            <span><b>{delivery.analysis.metrics.fillers}</b> fillers</span>
            <span><b>{delivery.analysis.metrics.word_count}</b> words</span>
          </div>
          <div className="fc-delivery-scores">
            {(['fluency', 'vocabulary', 'grammar', 'structure'] as const).map((key) => (
              <div key={key}>
                <span>{key}</span>
                <b>{delivery.analysis.scores[key]}/10</b>
                <i style={{ width: `${delivery.analysis.scores[key] * 10}%` }} />
              </div>
            ))}
          </div>
          <p className="fc-delivery-note">{delivery.analysis.feedback[delivery.analysis.feedback.length - 1]}</p>
        </>
      )}
    </div>
  );
}

function SignalRow({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'good' | 'quiet' }) {
  return <div className="fc-signal-row"><div className={`fc-signal-status ${tone}`} /><div className="fc-signal-copy"><b>{label}</b><span>{detail}</span></div><strong>{value}</strong></div>;
}

function trackingStatusLabel(status: TrackerStatus) {
  if (status === 'detected') return 'Detected';
  if (status === 'ready') return 'Ready';
  if (status === 'loading') return 'Loading model';
  return 'Model unavailable';
}

function trackingStatusDetail(status: TrackerStatus, signal: string) {
  if (status === 'detected') return `${signal} returned in the latest camera frame`;
  if (status === 'ready') return `Model loaded; move into frame to detect ${signal}`;
  if (status === 'loading') return `Loading ${signal} model from MediaPipe`;
  return `No ${signal} model is available`;
}

function ShortcutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fc-shortcut-backdrop" role="presentation" onClick={onClose}>
      <div className="fc-shortcut-panel" role="dialog" aria-modal="true" aria-labelledby="shortcut-title" onClick={(event) => event.stopPropagation()}>
        <div className="fc-card-head"><div><h3 className="fc-card-title" id="shortcut-title">Keyboard shortcuts</h3><span className="fc-card-meta">Available anywhere outside a text field</span></div><button className="fc-icon-button" onClick={onClose} aria-label="Close shortcuts"><X size={16} /></button></div>
        <div className="fc-shortcut-list"><div><kbd>1</kbd><span>Human Eye View</span></div><div><kbd>2</kbd><span>AI View</span></div><div><kbd>3</kbd><span>AI Tracking View</span></div><div><kbd>T</kbd><span>Transcript</span></div><div><kbd>F</kbd><span>Frequency / Audio</span></div><div><kbd>S</kbd><span>Scores</span></div><div><kbd>H</kbd><span>Shortcut Help</span></div><div><kbd>R</kbd><span>Restart assessment</span></div><div><kbd>P</kbd><span>Pause/resume</span></div><div><kbd>D</kbd><span>Dashboard</span></div><div><kbd>ESC</kbd><span>Close active overlay</span></div></div>
      </div>
    </div>
  );
}

function joinList(items: string[]) {
  if (items.length === 0) return 'more evidence';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function Feedback({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="fc-feedback-row"><div className="fc-feedback-icon">{icon}</div><div><h4>{title}</h4><p>{text}</p></div></div>;
}

function HistoryRow({ item }: { item: HistoryItem }) {
  return <div className="fc-history-item" data-testid={`history-row-${item.id}`}><div><strong>{item.title}</strong><span>{item.date} · {item.duration}</span></div><div className="fc-history-score">{item.score ?? '—'}<small>{item.score === null ? 'no score' : 'score'}</small></div><div className="fc-history-pill">{item.label}</div></div>;
}

function formatToday() {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const datePart = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${weekday} · ${datePart}`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <ScrollToTop />
      <Switch>
        <Route path="/app" component={Home} />
        <Route path="/" component={Intro} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
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