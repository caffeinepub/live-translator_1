# Vormo v16 - Video Translation Display Fix

## Current State
Vormo is a 2-way live voice translation app with video calling. Voice translation (walkie-talkie) works via polling backend messages. Video calling works via WebRTC with ICP signaling backend. The app shows A/B roles, translation messages in chat, and has audio unlock flow.

## Requested Changes (Diff)

### Add
- During video call, show what the other person said (original text + translated text) as a dedicated overlay/section inside the video call UI — so BOTH users can see each other's words in real-time during video call
- Video call translation mic: inside the video call controls, add a dedicated "🎤 Translate" button that triggers the same voice translation (startListening / toggleMic) — so users know they can still speak for translation during video call
- Label received messages from the other person during video call with "Unka bola:" and show original + translated text clearly
- Auto-attach remote stream to video element using a stable ref approach — every time remoteStream changes, re-attach srcObject to remoteVideoRef

### Modify
- `createPeerConnection`: ontrack handler should also update a stable `remoteStreamRef` so that if React re-renders, remoteVideoRef useEffect can still re-attach
- `remoteVideoRef` useEffect: watch both `remoteStream` state AND make it more robust with a retry on play() failure
- Video call UI: add a scrollable mini chat area inside the video panel showing the last 3-4 messages exchanged during the call, so users can see what was said/translated
- Video call controls: add a translation mic button (same as main mic) next to call controls, so user can press it during video call to send voice translation

### Remove
- Nothing to remove

## Implementation Plan
1. Add `remoteStreamRef = useRef<MediaStream | null>(null)` to hold remote stream stably
2. In `createPeerConnection` ontrack: set both `remoteStreamRef.current = stream` and call `onRemoteStream(stream)`, AND immediately set `remoteVideoRef.current.srcObject = stream`
3. Update `useEffect` for `remoteStream` to also call `remoteVideoRef.current.srcObject = remoteStreamRef.current` with retry logic
4. Inside video call UI (after call controls row), add a mini message list that shows last 4 messages from `messages` state with "me"/"them" labels and translated text
5. Inside video call controls row, add a translation mic button (calls `toggleMic()`) that shows active state when `isListening`
6. Update the "Translation continues during video call" note to be more prominent and actionable
