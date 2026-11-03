import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Camera, ChevronRight, Circle, Mic, Settings, CheckCircle2, Calendar, User, LogOut, Shield, Search, HelpCircle, Package, MessageCircle, LogIn, UserPlus } from 'lucide-react';
import { Card, Tabs, TabsList, TabsTrigger, TabsContent, Input, Label, Select, SelectItem, SelectTrigger, SelectValue, Switch, SwitchTrack, SwitchThumb, Badge } from '@/components/ui';
import { CalendarIcon } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { supabase } from '@/integrations/supabase';

// Types
type HistoryItem = {
  id: string;
  userId: string;
  username: string;
  date: string;
  score: number;
  status: 'completed' | 'guest' | 'failed';
  mistakes: { time: number; label: string; kind: 'good' | 'issue' }[];
};

type AuthStep = 'chooser' | 'new-account' | 'guest' | 'signed-in';

type SessionStats = {
  totalSessions: number;
  averageScore: number;
  totalTime: number;
  totalWords: number;
};

const MIN_SPEECH_WORDS = 40;
const MIN_SPEECH_SECONDS = 20;
const MIN_SESSION_SECONDS = 30;

// Camera/Mic selector types
type CameraDevice = { deviceId: string; label: string };
type MicDevice = { deviceId: string; label: string };

function Home() {
  const [authStep, setAuthStep] = useState<AuthStep>('chooser');
  const [identityName, setIdentityName] = useState('');
  const [active, setActive] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [speechWords, setSpeechWords] = useState(0);
  const [speechSeconds, setSpeechSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [frequencyData, setFrequencyData] = useState<number[]>(Array.from({ length: 24 }, () => 0));
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [faceKeypoints, setFaceKeypoints] = useState<Array<{ x: number; y: number; z?: number; visibility?: number }>>([]);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);
  [selectedCamera, setSelectedCamera] = useState<CameraDevice | null>(null);
  [selectedMic, setSelectedMic] = useState<MicDevice | null>(null);

  const { isLoaded, user, session, setActiveSession, createSession, updateSession, signIn, signUp, signOut, webhook } = useAuth();
  const { open: openToast } = useToast();

  // Load user preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('echo_labs_user_prefs');
    if (saved) {
      const prefs = JSON.parse(saved);
      setSelectedCamera(prefs.selectedCamera || null);
      setSelectedMic(prefs.selectedMic || null);
    }
  }, []);

  // Save user preferences to localStorage
  useEffect(() => {
    localStorage.setItem('echo_labs_user_prefs', JSON.stringify({ selectedCamera: selectedCamera?.deviceId, selectedMic: selectedMic?.deviceId }));
  }, [selectedCamera, selectedMic]);

  // Fetch camera and mic devices on mount
  useEffect(() => {
    if (typeof navigator.mediaDevices !== 'undefined' && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then(devices => {
          const cameras = devices.filter(d => d.kind === 'videoinput').map((d: any) => ({ deviceId: d.deviceId, label: d.label || `Camera ${devices.indexOf(d) + 1}` }));
          const mics = devices.filter(d => d.kind === 'audioinput').map((d: any) => ({ deviceId: d.deviceId, label: d.label || `Mic ${devices.indexOf(d) + 1}` }));
          setCameraDevices(cameras);
          setMicDevices(mics);
          // Select first available devices
          if (cameras.length > 0) setSelectedCamera(cameras[0]);
          if (mics.length > 0) setSelectedMic(mics[0]);
        })
        .catch(err => console.error('Error enumerating devices:', err));
    }
  }, []);

  // Auth step navigation
  const handleNext = () => {
    if (!identityName.trim()) return;
    setAuthStep('new-account');
  };

  const handleGuest = () => {
    setAuthStep('guest');
  };

  const handleSignIn = () => {
    setAuthStep('signed-in');
  };

  const chooseGuest = () => {
    // Guest mode - create a guest session
    setAuthStep('signed-in');
    // Initialize guest session
    const guestSession = {
      id: 'guest-' + Date.now(),
      userId: 'guest-' + Date.now(),
      username: 'Guest',
      date: new Date().toISOString(),
      status: 'guest',
      score: null,
      mistakes: []
    };
    // Store guest session locally
    localStorage.setItem('current_guest_session', JSON.stringify(guestSession));
    setActive(true);
    setCompleted(false);
    setScore(null);
    setSpeechWords(0);
    setSpeechSeconds(0);
    setAudioLevel(0);
    setTranscript('');
    setFrequencyData(Array.from({ length: 24 }, () => 0));
    setFaceBox(null);
    setFaceKeypoints([]);
    openToast({
      title: 'Guest Mode',
      description: 'You can start a guest session. Your score and history will not be saved.',
    });
  };

  const chooseNewAccount = () => {
    setAuthStep('new-account');
  };

  const handleCreateAccount = async () => {
    if (!identityName.trim()) return;
    try {
      await signUp({ 
        email: `${identityName.toLowerCase().replace(' ', '.')}${Date.now()}@example.com`, 
        password: 'password123',
        firstName: identityName.split(' ')[0] || 'User',
        lastName: identityName.split(' ').slice(1).join(' ') || 'User'
      });
      setAuthStep('signed-in');
      openToast({
        title: 'Account Created',
        description: 'Your account has been created successfully!',
      });
    } catch (error) {
      console.error('Sign up error:', error);
      openToast({
        title: 'Error',
        description: 'Failed to create account. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSignInAction = async () => {
    try {
      await signIn({ 
        strategy: 'password',
        emailPassword: {
          email: `${identityName.toLowerCase().replace(' ', '.')}@example.com`,
          password: 'password123'
        }
      });
      setAuthStep('signed-in');
      openToast({
        title: 'Signed In',
        description: 'Welcome back!',
      });
    } catch (error) {
      console.error('Sign in error:', error);
      openToast({
        title: 'Error',
        description: 'Failed to sign in. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // History data from Supabase
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [userStats, setUserStats] = useState<SessionStats>({ totalSessions: 0, averageScore: 0, totalTime: 0, totalWords: 0 });

  useEffect(() => {
    if (user?.id) {
      fetchHistory();
      fetchUserStats();
    }
  }, [user?.id]);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('session_history')
        .select('*')
        .order('date', { ascending: false });
      
      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const fetchUserStats = async () => {
    try {
      const { data, error } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', user?.id)
        .single();
      
      if (error) throw error;
      setUserStats(data || { totalSessions: 0, averageScore: 0, totalTime: 0, totalWords: 0 });
    } catch (error) {
      console.error('Error fetching user stats:', error);
    }
  };

  // Start session
  const handleStartSession = async () => {
    setActive(true);
    setCompleted(false);
    setScore(null);
    setSpeechWords(0);
    setSpeechSeconds(0);
    setAudioLevel(0);
    setTranscript('');
    setFrequencyData(Array.from({ length: 24 }, () => 0));
    setFaceBox(null);
    setFaceKeypoints([]);
    
    // Check if user is guest or signed in
    if (authStep === 'guest') {
      // Guest session - don't save to history
      const guestSession = {
        id: 'guest-' + Date.now(),
        userId: 'guest-' + Date.now(),
        username: 'Guest',
        date: new Date().toISOString(),
        status: 'guest',
        score: null,
        mistakes: []
      };
      localStorage.setItem('current_guest_session', JSON.stringify(guestSession));
    } else if (user?.id) {
      // Signed-in session - create session
      try {
        await createSession({
          userId: user.id,
          cameraId: selectedCamera?.deviceId,
          micId: selectedMic?.deviceId,
        });
      } catch (error) {
        console.error('Error creating session:', error);
      }
    }
  };

  // End session
  const handleEndSession = () => {
    setActive(false);
    setCompleted(true);
    
    // Save session to history if user is signed in
    if (user?.id && authStep !== 'guest') {
      const sessionData = {
        userId: user.id,
        username: user.fullName || user.email?.split('@')[0] || 'User',
        date: new Date().toISOString(),
        score: score,
        status: 'completed',
        mistakes: [] // Would be populated from analysis
      };
      
      supabase.from('session_history').insert([sessionData]).then(() => {
        fetchHistory();
        fetchUserStats();
      });
    }
  };

  // Sign out
  const handleSignOut = async () => {
    await signOut();
    setAuthStep('chooser');
    setSelectedCamera(null);
    setSelectedMic(null);
    localStorage.removeItem('echo_labs_user_prefs');
    localStorage.removeItem('current_guest_session');
    openToast({
      title: 'Signed Out',
      description: 'You have been signed out successfully.',
    });
  };

  // Guest - view score without history access
  const handleViewGuestScore = () => {
    const guestSession = JSON.parse(localStorage.getItem('current_guest_session') || '{}');
    if (guestSession.score !== null) {
      openToast({
        title: 'Guest Session Score',
        description: `Your guest session score: ${guestSession.score}`,
      });
    } else {
      openToast({
        title: 'No Score',
        description: 'No score was recorded for this guest session.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      {/* Auth Chooser Overlay */}
      {authStep === 'chooser' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">Welcome to EchoLabs</h2>
            <div className="space-y-4">
              <button 
                onClick={() => {
                  setAuthStep('new-account');
                  setIdentityName('');
                }}
                className="w-full bg-primary/10 text-primary hover:bg-primary/20 rounded-lg py-3 flex items-center justify-between"
              >
                <span>Create Account</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setAuthStep('guest')}
                className="w-full bg-secondary/10 text-secondary hover:bg-secondary/20 rounded-lg py-3 flex items-center justify-between"
              >
                <span>Continue as Guest</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setAuthStep('signed-in')}
                className="w-full bg-gray/10 text-gray-700 hover:bg-gray/20 rounded-lg py-3 flex items-center justify-between"
              >
                <span>Sign In</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-6">EchoLabs helps you improve your communication skills with AI-powered feedback.</p>
          </div>
        </div>
      )}

      {/* New Account Form */}
      {authStep === 'new-account' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">Create Account</h2>
            <p className="text-gray-600 mb-6">Enter your name to create an account</p>
            <Input
              placeholder="Your name"
              value={identityName}
              onValueChange={setIdentityName}
              className="mb-4"
            />
            <div className="flex space-x-2">
              <button 
                onClick={() => {
                  handleCreateAccount();
                  setAuthStep('signed-in');
                }}
                className="flex-1 bg-primary text-white rounded-lg py-2 px-4 hover:bg-primary/90"
              >
                Create Account
              </button>
              <button 
                onClick={() => {
                  setAuthStep('chooser');
                  setIdentityName('');
                }}
                className="flex-1 bg-gray-200 text-gray-700 rounded-lg py-2 px-4 hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guest Mode Overlay */}
      {authStep === 'guest' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">Continue as Guest</h2>
            <p className="text-gray-600 mb-6">Start a session without an account. Your data won't be saved to history.</p>
            <div className="flex space-x-2">
              <button 
                onClick={() => chooseGuest()}
                className="flex-1 bg-primary text-white rounded-lg py-2 px-4 hover:bg-primary/90"
              >
                Start Guest Session
              </button>
              <button 
                onClick={() => setAuthStep('chooser')}
                className="flex-1 bg-gray-200 text-gray-700 rounded-lg py-2 px-4 hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signed In Overlay */}
      {authStep === 'signed-in' && user?.id && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">Welcome Back!</h2>
            <p className="text-gray-600 mb-6">You're signed in. Start a new session or view your history.</p>
            <div className="space-y-4">
              <button 
                onClick={() => setAuthStep('chooser')}
                className="w-full bg-gray-200 text-gray-700 rounded-lg py-2 px-4 hover:bg-gray-300"
              >
                Start New Session
              </button>
              <button 
                onClick={() => { window.location.href = '/history'; }}
                className="w-full bg-secondary text-white rounded-lg py-2 px-4 hover:bg-secondary/90"
              >
                View History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Application */}
      <div className="relative min-h-screen">
        {/* Sidebar / Settings Menu */}
        <aside className="fixed left-0 top-0 h-full w-64 bg-background/90 border-r border-border flex-shrink-0 transition-transform transform transition-all duration-300 ease-in-out {isActive ? 'translateX(0)' : 'translateX(-100%)'}">
          <div className="p-6">
            <h2 className="text-xl font-bold mb-6">Settings</h2>
            
            {/* Camera Selection */}
            <div className="mb-4">
              <Label className="block text-sm font-medium mb-2">Camera</Label>
              <Select onValueChange={setSelectedCamera} className="w-full">
                <SelectTrigger>
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectItem value="">None</SelectItem>
                {cameraDevices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
              </Select>
            </div>

            {/* Microphone Selection */}
            <div className="mb-4">
              <Label className="block text-sm font-medium mb-2">Microphone</Label>
              <Select onValueChange={setSelectedMic} className="w-full">
                <SelectTrigger>
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectItem value="">None</SelectItem>
                {micDevices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
              </Select>
            </div>

            {/* Session Stats */}
            {authStep === 'signed-in' && user?.id && (
              <div className="mb-6 p-4 rounded-lg border">
                <h3 className="font-medium mb-2">Session Stats</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-xs text-gray-500">Sessions</p>
                    <p className="font-bold">{userStats.totalSessions}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Avg Score</p>
                    <p className="font-bold">{userStats.averageScore.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Time</p>
                    <p className="font-bold">{Math.round(userStats.totalTime / 60)}m</p>
                  </div>
                </div>
              </div>
            )}

            {/* Sign Out Button */}
            {authStep === 'signed-in' && (
              <button 
                onClick={handleSignOut}
                className="w-full mt-6 bg-destructive/10 text-destructive rounded-lg py-2 px-4 hover:bg-destructive/20 flex items-center justify-between"
              >
                Sign Out
                <Logout className="w-4 h-4" />
              </button>
            )}
          </div>
        </aside>

        {/* Content Area */}
        <main className="ml-64 min-h-screen p-6 overflow-x-hidden">
          {/* Header */}
          <header className="mb-6">
            <h1 className="text-3xl font-bold">EchoLabs</h1>
            <p className="text-gray-600">AI-powered communication coaching</p>
          </header>

          {/* Auth Check - Show overlay if not active */}
          {!active && authStep === 'signed-in' && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-10">
              <div className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl text-center">
                <h2 className="text-2xl font-bold mb-4">Select Camera & Microphone</h2>
                <p className="text-gray-600 mb-6">Please select your camera and microphone devices to start the session.</p>
                <div className="space-y-4">
                  <div>
                    <Label className="block text-sm font-medium">Camera</Label>
                    <Select onValueChange={setSelectedCamera} className="w-full">
                      <SelectTrigger>
                        <SelectValue placeholder="Select camera" />
                      </SelectTrigger>
                      <SelectItem value="">Select camera</SelectItem>
                      {cameraDevices.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label className="block text-sm font-medium">Microphone</Label>
                    <Select onValueChange={setSelectedMic} className="w-full">
                      <SelectTrigger>
                        <SelectValue placeholder="Select microphone" />
                      </SelectTrigger>
                      <SelectItem value="">Select microphone</SelectItem>
                      {micDevices.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <button 
                    onClick={handleStartSession}
                    className="w-full bg-primary text-white rounded-lg py-3 hover:bg-primary/90 font-medium"
                  >
                    Start Session
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Session Interface */}
          {active && (
            <div className="relative">
              {/* Score Panel */}
              <div className="absolute top-6 right-6 bg-white/90 backdrop-blur-sm rounded-xl p-4 min-w-48 shadow-xl">
                <div className="text-3xl font-bold {score !== null ? 'text-primary' : 'text-gray-400'}">
                  {score !== null ? score.toFixed(1) : '--'}
                </div>
                <p className="text-xs text-gray-500 mt-1">Score</p>
              </div>

              {/* Timer */}
              <div className="absolute top-6 left-6 bg-white/90 backdrop-blur-sm rounded-xl p-4">
                <div className="text-3xl font-bold">{Math.round(elapsed / 1000)}</div>
                <p className="text-xs text-gray-500 mt-1">Time</p>
              </div>

              {/* Voice Activity */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm rounded-full w-24 h-24 flex items-center justify-center">
                <div className="w-full h-full bg-gradient-to-b from-green-500 via-yellow-500 to-red-500 rounded-full transition-all duration-300" 
                     style={{ height: audioLevel > 0.5 ? '20px' : '10px' }}
                />
              </div>

              {/* Face Analysis Canvas Container */}
              <div className="relative flex-1">
                {/* Face Analysis Overlay */}
                {faceBox && (
                  <div className="absolute inset-0 ring-2 ring-primary/50 opacity-80">
                    {/* Visual feedback for face positioning */}
                  </div>
                )}

                {/* Microphone Visualization */}
                <canvas ref={canvasRef} className="absolute inset-0" />

                {/* Real-time Monitor */}
                <div className="absolute inset-0 opacity-50">
                  {/* Real-time monitoring UI */}
                </div>
              </div>

              {/* Transcript */}
              {transcript && (
                <div className="absolute bottom-10 left-6 right-6 bg-white/90 backdrop-blur-sm rounded-lg p-4 max-h-40 overflow-y-auto text-sm">
                  <p className="font-medium mb-2">Transcript</p>
                  <p>{transcript}</p>
                </div>
              )}

              {/* Controls */}
              <div className="absolute bottom-6 right-6 flex gap-3">
                <button
                  onClick={() => {
                    // Toggle recording
                    setAudioLevel(prev => prev > 0 ? 0 : 0.5);
                  }}
                  className="w-12 h-12 bg-primary rounded-full flex items-center justify-center hover:bg-primary/90 transition-colors"
                  aria-label="Toggle microphone"
                >
                  <Mic className="w-6 h-6 text-white" />
                </button>
                <button
                  onClick={() => setCompleted(true)}
                  className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center hover:bg-secondary/90 transition-colors"
                  aria-label="End session"
                >
                  <Circle className="w-6 h-6 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* Completed State */}
          {completed && score !== null && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
              <div className="bg-white rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
                <h2 className="text-3xl font-bold mb-4">Session Complete!</h2>
                <p className="text-gray-600 mb-6">Your score: {score.toFixed(1)}</p>
                <div className="space-y-4">
                  <button
                    onClick={() => {
                      setActive(false);
                      setCompleted(false);
                      setScore(null);
                      setSpeechWords(0);
                      setSpeechSeconds(0);
                      setAudioLevel(0);
                      setTranscript('');
                      setFrequencyData(Array.from({ length: 24 }, () => 0));
                      setFaceBox(null);
                      setFaceKeypoints([]);
                    }}
                    className="w-full bg-primary text-white rounded-lg py-2 px-4 hover:bg-primary/90 font-medium"
                  >
                    Start New Session
                  </button>
                  <button
                    onClick={() => { window.location.href = '/history'; }}
                    className="w-full bg-secondary text-white rounded-lg py-2 px-4 hover:bg-secondary/90 font-medium"
                  >
                    View History
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* History Preview (signed-in users) */}
          {authStep === 'signed-in' && user?.id && !completed && (
            <div className="mt-8 pt-8 border-t border-border">
              <h3 className="font-medium mb-4">Recent Sessions</h3>
              <div className="space-y-3">
                {history.slice(0, 5).map((item) => (
                  <div key={item.id} className="p-3 rounded-lg border hover:bg-accent/10 transition-colors">
                    <div className="flex justify-between items-start">
                      <span className="font-medium">{item.username}</span>
                      <span className="text-sm text-gray-500">{new Date(item.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-gray-500">{item.mistakes.length} issues detected</p>
                    {item.score && (
                      <p className="font-medium mt-1">{item.score.toFixed(1)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guest Score Access */}
          {authStep === 'guest' && !completed && (
            <div className="mt-8 pt-8 border-t border-border">
              <h3 className="font-medium mb-4">Guest Session</h3>
              <p className="text-gray-500 mb-4">Your guest session score will be shown here after completion.</p>
              <button
                onClick={handleViewGuestScore}
                className="w-full bg-primary text-white rounded-lg py-2 px-4 hover:bg-primary/90 font-medium"
              >
                View Guest Score
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default Home;