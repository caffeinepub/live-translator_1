# vormo-v16

## Current State
A 2-way live voice translation app (Vormo v15 equivalent). Two users join via a shared URL (?room=XXXXXX). Each device gets an A/B role automatically - the room creator is A (Hindi), the joiner is B (Chinese). Features include:
- Web Speech API for voice input
- MyMemory translation API for real-time translation
- SpeechSynthesis for audio playback on receiver side only (walkie-talkie)
- Audio unlock banner (required for mobile browsers)
- Speaker mute/unmute button
- 30-second recording timer with red warning at 20s
- Message delivery indicators (✓ sent, ✓✓ heard)
- Replay button (🔊) on received messages
- Latency indicator showing message travel time
- Speaking indicator (dots) when other person is composing
- Role badge (👤 A / 👤 B) in header
- Connection status badge (Connecting / Connected / Waiting)

Backend (Motoko) supports:
- ensureRoom(roomId): creates room or returns false if exists
- fetchMessagesSinceForRoomId(roomId, lastSeenIndex): returns new messages
- sendToRoom(roomId, message): stores a message
- checkRoomExists(roomId): query to check room

## Requested Changes (Diff)

### Add
- **Video calling via WebRTC** with ICP backend used for signaling (no external STUN/TURN servers needed initially, but include STUN)
- **"Start Video Call" button** visible to Person A after room is ready; Person B sees an incoming call banner with "Answer" / "Decline"
- **Video call UI**: full-screen remote video with picture-in-picture local video overlay, end call / mic mute / camera toggle controls
- **Mini translation chat overlay** during video calls: shows last 4 messages (both sides, WhatsApp-style) floating at bottom of video area
- **"T" (Translate) mic button** in video call controls, separate from WebRTC mic, for sending voice translations during video call
- **Voice translation during video calls** - the existing translation system must work while in a video call
- Signaling stored in backend via sendToRoom with special `__SIG__:` payload prefix
- ICE candidates queued until remote description is set
- Remote video stream set directly on video element via ontrack (not via React state)
- Remote video retry logic (500ms timeout) if stream resets
- STUN servers: stun:stun.l.google.com:19302

### Modify
- The voice translation (mic button, polling) must continue to work during video calls
- Role assignment: use localStorage to persist A/B role so refresh doesn't change it; first opener = A, second device = B

### Remove
- Nothing removed

## Implementation Plan
1. Update App.tsx to add WebRTC state variables: callState (idle/incoming/active), localStream, remoteStream, peerConnection ref, video element refs
2. Add signaling helpers: sendSignal(type, payload), pollSignals() - uses existing backend sendToRoom/fetchMessages with __SIG__: prefix
3. Add video call UI components: VideoCallUI (shows when callState=active), IncomingCallBanner, StartVideoCallButton
4. Implement WebRTC flow: A creates offer, sends via backend, B polls and answers, ICE exchange via backend messages
5. Add separate polling loop for WebRTC signals (faster interval: 1s)
6. Keep voice translation polling intact and running during calls
7. Mini chat overlay: track last 4 chatMessages and display in video call UI
8. "T" button: reuses existing startListening/stopListening but works while in call
9. localStorage role persistence so refresh doesn't flip A/B
10. Validate and build
