import { useState } from "react";
import { X, Camera, Mic, Play, BarChart3, ArrowRight, ArrowLeft, Target, CheckCircle2, Keyboard } from "lucide-react";

type OnboardingTutorialProps = {
  onComplete: () => void;
};

const steps = [
  {
    title: "Welcome to EchoLabs",
    description: "Your AI-powered communication coach that helps you improve your presence, speaking skills, and confidence through real-time feedback.",
    icon: <Play size={32} />,
  },
  {
    title: "Connect Your Camera & Microphone",
    description: "Grant access to your camera and microphone so we can analyze your eye contact, body language, voice tone, and speaking patterns in real-time.",
    icon: <Camera size={32} />,
  },
  {
    title: "Meet the Requirements",
    description: "To get an accurate score, aim for 40+ words, 20+ seconds of voice, and 30+ seconds of session time. The readiness panel will guide you through each step.",
    icon: <Target size={32} />,
  },
  {
    title: "Start a Practice Session",
    description: "Click 'Start session' to begin. Speak naturally while our real-time monitor tracks your performance and gives gentle nudges along the way.",
    icon: <Mic size={32} />,
  },
  {
    title: "Review & Improve",
    description: "After finishing, review your recording with clickable markers, get actionable feedback, and export reports. Use keyboard shortcuts (press ?) for quick access.",
    icon: <BarChart3 size={32} />,
  },
];

export function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const skip = () => {
    onComplete();
  };

  const step = steps[currentStep];

  return (
    <div className="fc-tutorial-backdrop">
      <div className="fc-tutorial-modal">
        <button className="fc-tutorial-close" onClick={skip} aria-label="Skip tutorial">
          <X size={18} />
        </button>
        
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', fontSize: '11px', color: '#888b92' }}>
            <span>Step {currentStep + 1} of {steps.length}</span>
            <span>{Math.round(((currentStep + 1) / steps.length) * 100)}%</span>
          </div>
          <div style={{ height: '4px', background: '#e4ded2', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${((currentStep + 1) / steps.length) * 100}%`, background: 'linear-gradient(90deg, #c3df39 0%, #a8c62a 100%)', transition: 'width 0.3s ease' }} />
          </div>
        </div>
        
        <div className="fc-tutorial-icon">
          {step.icon}
        </div>
        
        <h2 className="fc-tutorial-title">{step.title}</h2>
        <p className="fc-tutorial-description">{step.description}</p>
        
        <div className="fc-tutorial-dots">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`fc-tutorial-dot ${index === currentStep ? 'active' : ''}`}
            />
          ))}
        </div>
        
        <div className="fc-tutorial-actions">
          {currentStep > 0 && (
            <button className="fc-tutorial-btn secondary" onClick={prevStep}>
              <ArrowLeft size={16} />
              Back
            </button>
          )}
          <button className="fc-tutorial-btn primary" onClick={nextStep}>
            {currentStep === steps.length - 1 ? "Get Started" : "Next"}
            <ArrowRight size={16} />
          </button>
        </div>
        
        <button className="fc-tutorial-skip" onClick={skip}>
          Skip tutorial
        </button>
      </div>
    </div>
  );
}
