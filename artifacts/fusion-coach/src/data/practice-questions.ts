export type PracticeQuestion = { id: string; prompt: string; hint: string };

export const INTERVIEW_QUESTIONS: PracticeQuestion[] = [
  { id: "interview-intro", prompt: "What experience and priorities would you bring to this role?", hint: "Connect your current strengths to the work you want to do next." },
  { id: "interview-challenge", prompt: "Describe a difficult problem you helped resolve.", hint: "Set the context, explain your contribution, and state the outcome." },
  { id: "interview-feedback", prompt: "Tell me about a piece of feedback that changed how you work.", hint: "Describe the feedback, what you changed, and what happened afterward." },
  { id: "interview-disagreement", prompt: "How have you handled a disagreement with a teammate?", hint: "Show how you understood the other view and reached a practical decision." },
  { id: "interview-priorities", prompt: "How do you decide what to work on when several deadlines compete?", hint: "Give a specific method and an example of using it." },
  { id: "interview-learning", prompt: "What skill have you developed recently, and how did you practice it?", hint: "Use evidence of practice and explain where the skill is useful." },
];

export const DEBATE_MOTIONS: string[] = [
  "Public transit should be free in major cities.",
  "Schools should teach media literacy as a core subject.",
  "Cities should prioritize protected bike lanes over additional car lanes.",
  "Companies should publish salary ranges in every job posting.",
  "Governments should limit targeted advertising to children.",
  "A four-day workweek should be the default where practical.",
  "Public libraries should lend digital devices as well as books.",
  "Universities should require a course in practical financial literacy.",
];
