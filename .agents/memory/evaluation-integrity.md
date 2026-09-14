---
name: Evaluation integrity
description: Product rule for keeping multimodal coaching feedback honest and explainable.
---

Fusion Coach should distinguish between device/signal readiness, captured evidence, and a real communication-quality judgment. A quiet room or missing input must stay unscored and should explain what is missing instead of receiving a default number.

**Why:** A static score without captured speech or presence evidence makes the evaluation look arbitrary and breaks trust.

**How to apply:** Surface the evidence used by every score (camera presence, microphone activity, speech sample, duration), label demo or presence-only behavior explicitly, and reserve biometric identity claims for a connected recognition provider with consent.

The browser `FaceDetector` API is optional and only reports face geometry when supported; it is not an account identity provider. Treat unavailable support as a visible state and provide guest/new-account paths rather than auto-passing a face sign-in.