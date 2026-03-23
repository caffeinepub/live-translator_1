# vormo - 2-Way Live Translation Call

## Current State
Single-device translator app. User speaks or types, translation plays back on same device. No real-time connection between two users.

## Requested Changes (Diff)

### Add
- Motoko backend with room management: createRoom, joinRoom, sendMessage, getMessages (polling-based)
- Room creation flow: User creates a room, gets a shareable link
- Room join flow: Second user opens link and joins the room
- Each user selects their own language (English, Hindi, Chinese)
- Voice input triggers translation via MyMemory API, then sends translated message to backend
- Incoming messages are polled every 2 seconds and spoken aloud via Web Speech API
- Chat-style history of all exchanged messages in the room
- Room expires after inactivity (backend cleanup)

### Modify
- App entry point: show "Start a Room" landing instead of standalone translator
- Existing single-device translator remains accessible but secondary

### Remove
- Nothing removed from existing code; room feature is layered on top

## Implementation Plan
1. Backend: createRoom() -> roomId, joinRoom(roomId) -> Bool, sendMessage(roomId, speakerLabel, translatedText, targetLang) -> (), getMessages(roomId, since: Nat) -> [Message]
2. Frontend landing: "Start a Conversation" button that creates a room and shows shareable link
3. Frontend room page: two-panel UI, my mic + language on one side, incoming translations on other
4. Poll backend every 2 seconds for new messages, auto-play incoming audio
5. My own messages shown on right, other person's on left (chat bubble style)
