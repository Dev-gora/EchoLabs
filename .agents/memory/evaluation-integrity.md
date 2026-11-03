---
name: Evaluation integrity
description: Product rule for keeping multimodal coaching feedback honest and explainable.
---

EchoLabs should distinguish between device/signal readiness, captured evidence, and a real communication-quality judgment. A quiet room or missing input must stay unscored and should explain what is missing instead of receiving a default number.

**Why:** A static score without captured speech or presence evidence makes the evaluation look arbitrary and breaks trust.

**How to apply:** Surface the evidence used by every score (camera presence, microphone activity, speech sample, duration), label demo or presence-only behavior explicitly, and reserve biometric identity claims for a connected recognition provider with consent.

Face scan sign-in was removed on purpose: most laptop cameras cannot be relied on for a scan, so entry is a practice name or a guest session. The browser `FaceDetector` API is still optional and only reports face geometry for the live coaching preview; it is not an account identity provider. Treat unavailable support as a visible state.

Review scores may use transparent evidence and event deductions (speech sample, duration, pauses, fillers, repeated words), but must remain labeled as signal or delivery indicators rather than a claim of human communication quality.

The realtime voice monitor (`src/lib/realtime-monitor.ts`) scores pitch, volume and pausing against the speaker's own 7-second calibration baseline, never against an absolute ideal. Show a monitor as unmeasured ("—") when it had no speech blocks instead of letting the model's division guard turn silence into 100, and describe its output as distance from your own baseline, not as how good you sound.