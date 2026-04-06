import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  Camera,
  CameraOff,
  Check,
  CheckCheck,
  Copy,
  Globe,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Share2,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActor } from "./hooks/useActor";

// ─── Room ID auto-generation ──────────────────────────────────────────────────

function getOrCreateRoomId(): string {
  const params = new URLSearchParams(window.location.search);
  let roomId = params.get("room");
  if (!roomId) {
    roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    window.history.replaceState({}, "", `?room=${roomId}`);
  }
  return roomId;
}

const ROOM_ID = getOrCreateRoomId();
const SIG_ROOM_ID = `${ROOM_ID}-s`; // Separate room for WebRTC signaling

// Role is determined PURELY by URL param:
// - No ?as= in URL → this device is A (link sharer)
// - ?as=B in URL   → this device is B (link receiver)
// localStorage is used only to persist role across refresh for the same room.
const _asParam = new URLSearchParams(window.location.search).get("as");
const _storageKey = `vormo-role-${ROOM_ID}`;
const _savedRole = localStorage.getItem(_storageKey) as "A" | "B" | null;
// Determine role: URL param wins, then localStorage, then default to A
const INITIAL_ROLE: "A" | "B" = _asParam === "B" ? "B" : (_savedRole ?? "A");
// Persist it immediately
localStorage.setItem(_storageKey, INITIAL_ROLE);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  speaker: "me" | "them";
  text: string;
  originalText?: string;
  langCode: string;
  timestamp: number;
  status?: "sending" | "sent" | "heard";
  playing?: boolean;
  latencyMs?: number;
}

type CallState = "idle" | "outgoing" | "incoming" | "active";

const LANG_OPTIONS = [
  { code: "en", label: "English", flag: "🇬🇧", tts: "en-US" },
  { code: "hi", label: "Hindi", flag: "🇮🇳", tts: "hi-IN" },
  { code: "zh", label: "Chinese", flag: "🇨🇳", tts: "zh-CN" },
];

function getLang(code: string) {
  return LANG_OPTIONS.find((l) => l.code === code) ?? LANG_OPTIONS[0];
}

// ─── Translation helper ───────────────────────────────────────────────────────

async function translateText(
  text: string,
  from: string,
  to: string,
): Promise<string> {
  if (from === to) return text;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const res = await fetch(url);
  const data = await res.json();
  return (data?.responseData?.translatedText as string) ?? text;
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    const handler = () => {
      resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.onvoiceschanged = null;
    };
    window.speechSynthesis.onvoiceschanged = handler;
    setTimeout(() => {
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    }, 1500);
  });
}

async function speak(text: string, ttsLang: string): Promise<void> {
  if (!window.speechSynthesis) {
    console.warn("[vormo] SpeechSynthesis not available");
    return;
  }
  try {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      await new Promise((r) => setTimeout(r, 120));
    }

    const voices = await getVoices();
    return new Promise((resolve) => {
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = ttsLang;
      utt.rate = 0.9;
      utt.pitch = 1;
      utt.volume = 1;

      if (voices.length > 0) {
        const langPrefix = ttsLang.split("-")[0].toLowerCase();
        const match = voices.find((v) =>
          v.lang.toLowerCase().startsWith(langPrefix),
        );
        if (match) utt.voice = match;
      }

      utt.onend = () => resolve();
      utt.onerror = (e) => {
        console.warn("[vormo] TTS error:", e.error);
        resolve();
      };

      window.speechSynthesis.speak(utt);

      const safetyMs = Math.max(4000, text.length * 120);
      setTimeout(resolve, safetyMs);
    });
  } catch (err) {
    console.warn("[vormo] speak() threw:", err);
  }
}

// ─── Speak Queue ──────────────────────────────────────────────────────────────

type SpeakJob = { text: string; ttsLang: string; onDone?: () => void };

const speakQueue: SpeakJob[] = [];
let speakQueueRunning = false;

function enqueueSpeech(job: SpeakJob) {
  speakQueue.push(job);
  if (!speakQueueRunning) drainSpeakQueue();
}

async function drainSpeakQueue() {
  speakQueueRunning = true;
  while (speakQueue.length > 0) {
    const job = speakQueue.shift()!;
    await speak(job.text, job.ttsLang);
    job.onDone?.();
  }
  speakQueueRunning = false;
}

// ─── Wave bars (listening) ─────────────────────────────────────────────────────

const WAVE_ANIMS = ["wave-1", "wave-2", "wave-3", "wave-4", "wave-5"] as const;

function WaveBars() {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {WAVE_ANIMS.map((anim) => (
        <div
          key={anim}
          className={`w-[3px] rounded-full bg-primary animate-${anim}`}
          style={{ height: "100%" }}
        />
      ))}
    </div>
  );
}

// ─── Typing dots (they are speaking) ─────────────────────────────────────────

function SpeakingIndicator() {
  return (
    <motion.div
      key="speaking-indicator"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2 }}
      className="flex justify-start"
    >
      <div className="glass rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 h-2 rounded-full bg-primary/70"
            animate={{ y: [0, -5, 0] }}
            transition={{
              duration: 0.7,
              repeat: Number.POSITIVE_INFINITY,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
        <span className="text-xs text-muted-foreground ml-1">
          Translating...
        </span>
      </div>
    </motion.div>
  );
}

// ─── Message status ───────────────────────────────────────────────────────────

function MessageStatus({ status }: { status?: "sending" | "sent" | "heard" }) {
  if (!status) return null;
  if (status === "sending")
    return (
      <Loader2 className="w-3 h-3 text-muted-foreground/60 animate-spin" />
    );
  if (status === "sent")
    return <Check className="w-3 h-3 text-muted-foreground/60" />;
  return <CheckCheck className="w-3.5 h-3.5 text-primary" />;
}

// ─── Latency badge ────────────────────────────────────────────────────────────

function LatencyBadge({ ms }: { ms: number }) {
  const label = ms < 1000 ? "<1s" : `${(ms / 1000).toFixed(1)}s`;
  return (
    <span className="text-[10px] text-muted-foreground/50 ml-1">{label}</span>
  );
}

// ─── WebRTC ICE config ────────────────────────────────────────────────────────

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.stunprotocol.org:3478" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { actor, isFetching } = useActor();

  const [myLang, setMyLang] = useState("hi");
  const [theirLang, setTheirLang] = useState("zh");
  const [myRole, setMyRole] = useState<"A" | "B">("A");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasOtherSpeaker, setHasOtherSpeaker] = useState(false);
  const [theyAreSpeaking, setTheyAreSpeaking] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // ─── Video call state ────────────────────────────────────────────────────────
  const [callState, setCallState] = useState<CallState>("idle");
  const [callConnected, setCallConnected] = useState(false);
  const [videoMicMuted, setVideoMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [isVideoListening, setIsVideoListening] = useState(false);
  const [videoRecordingSeconds, setVideoRecordingSeconds] = useState(0);

  const mySessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const lastFetchedCountRef = useRef<bigint>(0n);
  const sigIndexRef = useRef<bigint>(0n);
  const recognitionRef = useRef<any>(null);
  const videoRecognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const myLangRef = useRef(myLang);
  const theirLangRef = useRef(theirLang);
  const theyAreSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const audioUnlockedRef = useRef(false);
  const roomReadyRef = useRef(false);
  const speakerMutedRef = useRef(false);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const videoRecordingIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const actorRef = useRef(actor);
  const myRoleRef = useRef<"A" | "B">("A");

  // WebRTC refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const callStateRef = useRef<CallState>("idle");

  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  useEffect(() => {
    myLangRef.current = myLang;
  }, [myLang]);
  useEffect(() => {
    theirLangRef.current = theirLang;
  }, [theirLang]);
  useEffect(() => {
    audioUnlockedRef.current = audioUnlocked;
  }, [audioUnlocked]);
  useEffect(() => {
    roomReadyRef.current = roomReady;
  }, [roomReady]);
  useEffect(() => {
    speakerMutedRef.current = speakerMuted;
  }, [speakerMuted]);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);
  useEffect(() => {
    myRoleRef.current = myRole;
  }, [myRole]);

  // ─── Recording timer (voice) ───────────────────────────────────────────────
  useEffect(() => {
    if (isListening) {
      setRecordingSeconds(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      setRecordingSeconds(0);
    }
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, [isListening]);

  // ─── Recording timer (video mic) ──────────────────────────────────────────
  useEffect(() => {
    if (isVideoListening) {
      setVideoRecordingSeconds(0);
      videoRecordingIntervalRef.current = setInterval(() => {
        setVideoRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (videoRecordingIntervalRef.current) {
        clearInterval(videoRecordingIntervalRef.current);
        videoRecordingIntervalRef.current = null;
      }
      setVideoRecordingSeconds(0);
    }
    return () => {
      if (videoRecordingIntervalRef.current) {
        clearInterval(videoRecordingIntervalRef.current);
        videoRecordingIntervalRef.current = null;
      }
    };
  }, [isVideoListening]);

  // Auto-stop at 30 seconds
  useEffect(() => {
    if (recordingSeconds >= 30 && isListening) {
      stopListening();
    }
  }, [recordingSeconds, isListening]);

  useEffect(() => {
    if (videoRecordingSeconds >= 30 && isVideoListening) {
      stopVideoListening();
    }
  }, [videoRecordingSeconds, isVideoListening]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll on messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, theyAreSpeaking]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (theyAreSpeakingTimerRef.current)
        clearTimeout(theyAreSpeakingTimerRef.current);
    };
  }, []);

  // ─── Ensure room on actor mount ────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomReady used as guard only
  useEffect(() => {
    if (!actor || isFetching || roomReady) return;
    setIsConnecting(true);

    // Role is already determined at module load time from URL + localStorage
    const isA = INITIAL_ROLE === "A";
    if (isA) {
      setMyRole("A");
      myRoleRef.current = "A";
      setMyLang("hi");
      setTheirLang("zh");
      myLangRef.current = "hi";
      theirLangRef.current = "zh";
    } else {
      setMyRole("B");
      myRoleRef.current = "B";
      setMyLang("zh");
      setTheirLang("hi");
      myLangRef.current = "zh";
      theirLangRef.current = "hi";
    }

    // Register both voice room and signal room in backend
    Promise.all([
      actor.ensureRoom(ROOM_ID).catch(() => {}),
      actor.ensureRoom(SIG_ROOM_ID).catch(() => {}),
    ]).finally(() => {
      setRoomReady(true);
      roomReadyRef.current = true;
      setIsConnecting(false);
    });
  }, [actor, isFetching]);

  // ─── Audio unlock ──────────────────────────────────────────────────────────
  function unlockAudio() {
    if (audioUnlockedRef.current) return;
    setAudioUnlocked(true);
    audioUnlockedRef.current = true;

    const readyPhrases: Record<string, string> = {
      hi: "तैयार",
      zh: "准备好了",
      en: "Ready",
    };
    const phrase = readyPhrases[myLangRef.current] ?? "Ready";
    const ttsLang = getLang(myLangRef.current).tts;

    const utt = new SpeechSynthesisUtterance(phrase);
    utt.lang = ttsLang;
    utt.volume = 0.7;
    utt.rate = 1;
    utt.pitch = 1;
    utt.onend = () => toast.success("🔊 Audio on! Ab awaaz aayegi.");
    utt.onerror = () => {
      toast.success("🔊 Audio ready!");
    };
    window.speechSynthesis.speak(utt);
  }

  // ─── Voice Polling ─────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!actor || !roomReadyRef.current) return;
    try {
      const fetched = await actor.fetchMessagesSinceForRoomId(
        ROOM_ID,
        lastFetchedCountRef.current,
      );
      if (fetched.length === 0) return;

      lastFetchedCountRef.current += BigInt(fetched.length);

      const newMsgs: ChatMessage[] = [];
      const myId = mySessionIdRef.current;
      const mySysId = `sys-${myId}`;

      for (const msg of fetched) {
        if (msg.speaker === myId || msg.speaker === mySysId) continue;

        // Filter out signaling messages
        if (msg.languageCode === "sig") continue;

        if (msg.languageCode === "sys" && msg.speaker.startsWith("sys-")) {
          if (msg.payload === "__SPEAKING__") {
            setTheyAreSpeaking(true);
            if (theyAreSpeakingTimerRef.current)
              clearTimeout(theyAreSpeakingTimerRef.current);
            theyAreSpeakingTimerRef.current = setTimeout(
              () => setTheyAreSpeaking(false),
              4000,
            );
          } else if (msg.payload.startsWith("__ACK__:")) {
            setMessages((prev) => {
              const reversed = [...prev].reverse();
              const lastSentIdx = reversed.findIndex(
                (m) => m.speaker === "me" && m.status === "sent",
              );
              if (lastSentIdx === -1) return prev;
              const actualIdx = prev.length - 1 - lastSentIdx;
              return prev.map((m, i) =>
                i === actualIdx ? { ...m, status: "heard" } : m,
              );
            });
          }
          continue;
        }

        if (msg.payload.startsWith("__")) continue;

        setHasOtherSpeaker(true);
        setTheyAreSpeaking(false);
        if (theyAreSpeakingTimerRef.current)
          clearTimeout(theyAreSpeakingTimerRef.current);

        const langInfo = getLang(msg.languageCode);
        const msgId = `them-${msg.timestamp.toString()}`;
        const latencyMs = Date.now() - Number(msg.timestamp / 1_000_000n);

        newMsgs.push({
          id: msgId,
          speaker: "them",
          text: msg.payload,
          langCode: msg.languageCode,
          timestamp: Number(msg.timestamp),
          playing: true,
          latencyMs,
        });

        const capturedMsgId = msgId;
        const capturedActor = actor;

        if (!speakerMutedRef.current) {
          enqueueSpeech({
            text: msg.payload,
            ttsLang: langInfo.tts,
            onDone: () => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === capturedMsgId ? { ...m, playing: false } : m,
                ),
              );
              if (capturedActor) {
                capturedActor
                  .sendToRoom(ROOM_ID, {
                    speaker: mySysId,
                    languageCode: "sys",
                    payload: `__ACK__:${msg.timestamp.toString()}`,
                  })
                  .catch(() => {});
              }
            },
          });
        } else {
          setTimeout(() => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === capturedMsgId ? { ...m, playing: false } : m,
              ),
            );
            if (capturedActor) {
              capturedActor
                .sendToRoom(ROOM_ID, {
                  speaker: mySysId,
                  languageCode: "sys",
                  payload: `__ACK__:${msg.timestamp.toString()}`,
                })
                .catch(() => {});
            }
          }, 300);
        }
      }

      if (newMsgs.length > 0) {
        setMessages((prev) => [...prev, ...newMsgs]);
      }
    } catch {
      // silent poll failure
    }
  }, [actor]);

  useEffect(() => {
    if (!roomReady) return;
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [poll, roomReady]);

  // ─── Signal Polling (separate loop for WebRTC signaling) ─────────────────
  const pollSignals = useCallback(async () => {
    const currentActor = actorRef.current;
    if (!currentActor || !roomReadyRef.current) return;
    try {
      const fetched = await currentActor.fetchMessagesSinceForRoomId(
        SIG_ROOM_ID,
        sigIndexRef.current,
      );
      if (fetched.length === 0) return;

      sigIndexRef.current += BigInt(fetched.length);

      const myId = mySessionIdRef.current;

      for (const msg of fetched) {
        // Skip own messages
        if (msg.speaker === `sig-${myId}`) continue;
        if (!msg.payload.startsWith("__SIG__:")) continue;

        const sigContent = msg.payload.slice("__SIG__:".length);
        const colonIdx = sigContent.indexOf(":");
        if (colonIdx === -1) continue;
        const sigType = sigContent.slice(0, colonIdx);
        const sigData = sigContent.slice(colonIdx + 1);

        if (
          sigType === "offer" &&
          myRoleRef.current === "B" &&
          callStateRef.current === "idle"
        ) {
          // B receives offer → show incoming call
          setCallState("incoming");
          callStateRef.current = "incoming";
          // Store offer for answering
          pendingOfferRef.current = sigData;
        } else if (sigType === "answer" && myRoleRef.current === "A") {
          // A receives answer
          if (pcRef.current && pcRef.current.signalingState !== "closed") {
            try {
              const answer = JSON.parse(sigData) as RTCSessionDescriptionInit;
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription(answer),
              );
              remoteDescSetRef.current = true;
              // Drain queued ICE candidates
              for (const candidate of iceCandidateQueueRef.current) {
                await pcRef.current
                  .addIceCandidate(new RTCIceCandidate(candidate))
                  .catch(() => {});
              }
              iceCandidateQueueRef.current = [];
            } catch (e) {
              console.warn("[vormo] setRemoteDescription(answer) failed:", e);
            }
          }
        } else if (sigType === "ice") {
          // ICE candidate from remote
          try {
            const candidate = JSON.parse(sigData) as RTCIceCandidateInit;
            if (pcRef.current && remoteDescSetRef.current) {
              await pcRef.current
                .addIceCandidate(new RTCIceCandidate(candidate))
                .catch(() => {});
            } else {
              iceCandidateQueueRef.current.push(candidate);
            }
          } catch (e) {
            console.warn("[vormo] ICE candidate error:", e);
          }
        } else if (sigType === "end") {
          // Remote ended call
          endCall();
        }
      }
    } catch {
      // silent
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingOfferRef = useRef<string | null>(null);

  // Start signal polling when room is ready
  // Use faster interval (500ms) during call setup to reduce ICE timing issues
  useEffect(() => {
    if (!roomReady) return;
    const interval = callState === "idle" ? 1000 : 500;
    const timer = setInterval(pollSignals, interval);
    return () => clearInterval(timer);
  }, [pollSignals, roomReady, callState]);

  // ─── Helper: send signal ──────────────────────────────────────────────────
  async function sendSignal(type: string, data: string) {
    const currentActor = actorRef.current;
    if (!currentActor) return;
    const myId = mySessionIdRef.current;
    await currentActor
      .sendToRoom(SIG_ROOM_ID, {
        speaker: `sig-${myId}`,
        languageCode: "sig",
        payload: `__SIG__:${type}:${data}`,
      })
      .catch(() => {});
  }

  // ─── Create PeerConnection ────────────────────────────────────────────────
  function createPC(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal("ice", JSON.stringify(event.candidate.toJSON()));
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.play().catch(() => {});
        // Retry after 500ms in case of re-render
        setTimeout(() => {
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0];
            remoteVideoRef.current.play().catch(() => {});
          }
        }, 500);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "connected" || state === "completed") {
        setCallConnected(true);
        setCallState("active");
        callStateRef.current = "active";
      } else if (state === "failed") {
        endCall();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setCallConnected(true);
        setCallState("active");
        callStateRef.current = "active";
      } else if (state === "failed" || state === "closed") {
        endCall();
      }
    };

    return pc;
  }

  // ─── Start Video Call (Person A) ──────────────────────────────────────────
  async function startVideoCall() {
    if (!roomReady || callState !== "idle") return;
    setCallState("outgoing");
    callStateRef.current = "outgoing";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = createPC();
      pcRef.current = pc;
      remoteDescSetRef.current = false;
      iceCandidateQueueRef.current = [];

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await sendSignal("offer", JSON.stringify(offer));
      toast.success("📹 Calling... Dusre device pe answer karo");

      // Auto-cancel after 30 seconds if no answer received
      setTimeout(() => {
        if (callStateRef.current === "outgoing") {
          toast.error("⏱️ 30s ho gaye, call connect nahi hua. Dobara try karo.");
          endCall();
        }
      }, 30000);
    } catch (err) {
      console.error("[vormo] startVideoCall error:", err);
      toast.error("Camera/Mic access nahi mila. Permission check karo.");
      setCallState("idle");
      callStateRef.current = "idle";
    }
  }

  // ─── Answer Call (Person B) ───────────────────────────────────────────────
  async function answerCall() {
    const offerData = pendingOfferRef.current;
    if (!offerData) {
      toast.error("Offer nahi mila. Dobara try karo.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = createPC();
      pcRef.current = pc;
      remoteDescSetRef.current = false;
      iceCandidateQueueRef.current = [];

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const offer = JSON.parse(offerData) as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescSetRef.current = true;

      // Drain any queued ICE candidates
      for (const candidate of iceCandidateQueueRef.current) {
        await pc
          .addIceCandidate(new RTCIceCandidate(candidate))
          .catch(() => {});
      }
      iceCandidateQueueRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal("answer", JSON.stringify(answer));

      setCallState("active");
      callStateRef.current = "active";
      pendingOfferRef.current = null;
    } catch (err) {
      console.error("[vormo] answerCall error:", err);
      toast.error("Call answer nahi hua. Camera/Mic permission check karo.");
      setCallState("idle");
      callStateRef.current = "idle";
    }
  }

  // ─── End Call ─────────────────────────────────────────────────────────────
  function endCall() {
    // Send end signal to remote
    sendSignal("end", "bye").catch(() => {});

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    remoteDescSetRef.current = false;
    iceCandidateQueueRef.current = [];
    pendingOfferRef.current = null;

    setCallState("idle");
    callStateRef.current = "idle";
    setCallConnected(false);
    setVideoMicMuted(false);
    setCameraOff(false);

    // Stop video recognition if running
    videoRecognitionRef.current?.stop();
    setIsVideoListening(false);
  }

  // ─── Decline Call ─────────────────────────────────────────────────────────
  function declineCall() {
    pendingOfferRef.current = null;
    setCallState("idle");
    callStateRef.current = "idle";
    sendSignal("end", "declined").catch(() => {});
  }

  // ─── Toggle video mic (WebRTC track) ──────────────────────────────────────
  function toggleVideoMic() {
    if (!localStreamRef.current) return;
    const newMuted = !videoMicMuted;
    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = !newMuted;
    }
    setVideoMicMuted(newMuted);
  }

  // ─── Toggle camera ────────────────────────────────────────────────────────
  function toggleCamera() {
    if (!localStreamRef.current) return;
    const newOff = !cameraOff;
    for (const track of localStreamRef.current.getVideoTracks()) {
      track.enabled = !newOff;
    }
    setCameraOff(newOff);
  }

  // ─── Video Translation Mic (T button) ────────────────────────────────────
  function startVideoListening() {
    if (!audioUnlockedRef.current) {
      toast.warning("Pehle 'Enable Audio' dabao 👆");
      return;
    }

    const w = window as any;
    const SRCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SRCtor) {
      toast.error("Speech recognition not supported.");
      return;
    }

    const myId = mySessionIdRef.current;
    const mySysId = `sys-${myId}`;

    if (actorRef.current) {
      actorRef.current
        .sendToRoom(ROOM_ID, {
          speaker: mySysId,
          languageCode: "sys",
          payload: "__SPEAKING__",
        })
        .catch(() => {});
    }

    const rec = new SRCtor();
    rec.lang = getLang(myLangRef.current).tts;
    rec.interimResults = false;
    rec.continuous = false;

    rec.onresult = async (event: any) => {
      const spoken = event.results[0][0].transcript;
      setIsVideoListening(false);

      const msgId = `me-${Date.now()}`;

      try {
        const translated = await translateText(
          spoken,
          myLangRef.current,
          theirLangRef.current,
        );

        const myMsg: ChatMessage = {
          id: msgId,
          speaker: "me",
          text: translated,
          originalText: spoken,
          langCode: theirLangRef.current,
          timestamp: Date.now(),
          status: "sending",
        };
        setMessages((prev) => [...prev, myMsg]);

        const currentActor = actorRef.current;
        if (currentActor) {
          await currentActor.sendToRoom(ROOM_ID, {
            speaker: myId,
            languageCode: theirLangRef.current,
            payload: translated,
          });
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, status: "sent" } : m)),
          );
        }
      } catch {
        toast.error("Translation fail hua.");
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      }
    };

    rec.onerror = () => {
      setIsVideoListening(false);
    };
    rec.onend = () => setIsVideoListening(false);

    videoRecognitionRef.current = rec;
    rec.start();
    setIsVideoListening(true);
  }

  function stopVideoListening() {
    videoRecognitionRef.current?.stop();
    setIsVideoListening(false);
  }

  function toggleVideoTranslationMic() {
    if (isVideoListening) stopVideoListening();
    else startVideoListening();
  }

  // ─── Voice Mic (main) ─────────────────────────────────────────────────────
  function startListening() {
    if (!audioUnlockedRef.current) {
      toast.warning("Pehle 'Enable Audio' dabao 👆");
      return;
    }

    const w = window as any;
    const SRCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SRCtor) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    const myId = mySessionIdRef.current;
    const mySysId = `sys-${myId}`;

    if (actor) {
      actor
        .sendToRoom(ROOM_ID, {
          speaker: mySysId,
          languageCode: "sys",
          payload: "__SPEAKING__",
        })
        .catch(() => {});
    }

    const rec = new SRCtor();
    rec.lang = getLang(myLangRef.current).tts;
    rec.interimResults = false;
    rec.continuous = false;

    rec.onresult = async (event: any) => {
      const spoken = event.results[0][0].transcript;
      setIsListening(false);
      setIsTranslating(true);

      const msgId = `me-${Date.now()}`;

      try {
        const translated = await translateText(
          spoken,
          myLangRef.current,
          theirLangRef.current,
        );

        const myMsg: ChatMessage = {
          id: msgId,
          speaker: "me",
          text: translated,
          originalText: spoken,
          langCode: theirLangRef.current,
          timestamp: Date.now(),
          status: "sending",
        };
        setMessages((prev) => [...prev, myMsg]);

        if (actor) {
          await actor.sendToRoom(ROOM_ID, {
            speaker: myId,
            languageCode: theirLangRef.current,
            payload: translated,
          });
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, status: "sent" } : m)),
          );
        }
      } catch {
        toast.error("Translation fail hua. Dobara try karein.");
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      } finally {
        setIsTranslating(false);
      }
    };

    rec.onerror = () => {
      setIsListening(false);
      toast.error("Mic error. Please try again.");
    };

    rec.onend = () => setIsListening(false);

    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function toggleMic() {
    if (isListening) stopListening();
    else startListening();
  }

  function toggleSpeaker() {
    setSpeakerMuted((prev) => !prev);
    speakerMutedRef.current = !speakerMutedRef.current;
  }

  // Copy share link — always share the &as=B version so receiver becomes B
  async function copyLink() {
    const params = new URLSearchParams(window.location.search);
    params.set("as", "B");
    const shareLink = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    toast.success("Link copy ho gaya! Share karo.");
    setTimeout(() => setCopied(false), 2000);
  }

  const myLangInfo = getLang(myLang);
  const theirLangInfo = getLang(theirLang);
  const micDisabled = isTranslating || isConnecting || !roomReady;

  const timerColor =
    recordingSeconds >= 20
      ? "text-red-500 font-bold"
      : "text-primary font-medium";
  const timerLabel = `0:${String(recordingSeconds).padStart(2, "0")}`;

  const videoTimerColor =
    videoRecordingSeconds >= 20 ? "text-red-400" : "text-emerald-400";
  const videoTimerLabel = `0:${String(videoRecordingSeconds).padStart(2, "0")}`;

  // Last 4 messages for mini chat in video call
  const miniChatMessages = messages.slice(-4);

  const isInVideoCall = callState === "active";

  return (
    <>
      <Toaster position="top-center" />

      {/* Ambient BG */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] rounded-full bg-accent/4 blur-3xl" />
      </div>

      <div className="min-h-screen flex flex-col max-w-[480px] mx-auto px-4 pt-4 pb-6 relative z-10">
        {/* ── Header ── */}
        <header className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Globe className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-xl tracking-tight">vormo</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Role badge */}
            {roomReady && (
              <Badge
                variant="outline"
                data-ocid="app.badge"
                className={
                  myRole === "A"
                    ? "gap-1 text-xs border-blue-500/50 text-blue-600 dark:text-blue-400 px-2 py-0.5"
                    : "gap-1 text-xs border-purple-500/50 text-purple-600 dark:text-purple-400 px-2 py-0.5"
                }
              >
                👤 {myRole === "A" ? "A (Hindi)" : "B (Chinese)"}
              </Badge>
            )}

            {/* Connection badge */}
            {isConnecting || (!roomReady && !hasOtherSpeaker) ? (
              <Badge
                variant="outline"
                className="gap-1.5 text-xs border-amber-500/50 text-amber-600 dark:text-amber-400"
                data-ocid="app.loading_state"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                Connecting...
              </Badge>
            ) : hasOtherSpeaker ? (
              <Badge
                variant="outline"
                className="gap-1.5 text-xs border-accent/50 text-accent"
                data-ocid="app.success_state"
              >
                <Wifi className="w-3 h-3" />
                Connected
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1.5 text-xs border-muted-foreground/30 text-muted-foreground"
                data-ocid="app.loading_state"
              >
                <WifiOff className="w-3 h-3" />
                Waiting...
              </Badge>
            )}
          </div>
        </header>

        {/* ── Audio Unlock Banner ── */}
        <AnimatePresence>
          {!audioUnlocked && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="mb-3 px-4 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2"
            >
              <span className="text-base">🔊</span>
              <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">
                <strong>Pehle yahan tap karo</strong> — nahin to awaaz nahi
                aayegi
              </p>
              <button
                type="button"
                data-ocid="app.primary_button"
                onClick={unlockAudio}
                className="text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-xl shrink-0 transition-colors"
              >
                Enable Audio
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Share Link Bar ── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass rounded-2xl px-4 py-3 mb-4"
        >
          <p className="text-xs text-muted-foreground mb-1">
            Yeh link share karo 👇
          </p>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs font-mono text-foreground/80 truncate">
              {(() => {
                const p = new URLSearchParams(window.location.search);
                p.set("as", "B");
                return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
              })()}
            </p>
            <Button
              data-ocid="app.primary_button"
              size="sm"
              onClick={copyLink}
              className={`gap-1.5 shrink-0 rounded-xl h-8 px-3 text-xs font-semibold transition-all ${
                copied
                  ? "bg-accent text-accent-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {copied ? (
                <Check className="w-3 h-3" />
              ) : (
                <Share2 className="w-3 h-3" />
              )}
              {copied ? "Copied!" : "Share"}
            </Button>
            <Button
              data-ocid="app.secondary_button"
              size="sm"
              variant="ghost"
              onClick={copyLink}
              className="shrink-0 rounded-xl h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </motion.div>

        {/* ── Incoming Call Banner ── */}
        <AnimatePresence>
          {callState === "incoming" && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.3 }}
              className="mb-4 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex items-center gap-3"
              data-ocid="videocall.dialog"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY }}
              >
                <Video className="w-5 h-5 text-emerald-400" />
              </motion.div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-300">
                  📹 Incoming video call...
                </p>
                <p className="text-xs text-muted-foreground">
                  Doosra banda call kar raha hai
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-ocid="videocall.confirm_button"
                  onClick={answerCall}
                  className="text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-xl transition-colors"
                >
                  Answer
                </button>
                <button
                  type="button"
                  data-ocid="videocall.cancel_button"
                  onClick={declineCall}
                  className="text-xs font-bold text-white bg-destructive hover:bg-destructive/80 px-3 py-1.5 rounded-xl transition-colors"
                >
                  Decline
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Outgoing Call Banner ── */}
        <AnimatePresence>
          {callState === "outgoing" && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="mb-4 px-4 py-3 rounded-2xl bg-primary/10 border border-primary/30 flex items-center gap-3"
              data-ocid="videocall.loading_state"
            >
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-primary">
                  📹 Calling...
                </p>
                <p className="text-xs text-muted-foreground">
                  Doosre device pe answer karo
                </p>
              </div>
              <button
                type="button"
                data-ocid="videocall.cancel_button"
                onClick={endCall}
                className="text-xs font-bold text-white bg-destructive hover:bg-destructive/80 px-3 py-1.5 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Video Call UI (active) ── */}
        <AnimatePresence>
          {isInVideoCall && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.35 }}
              className="mb-4 rounded-2xl overflow-hidden relative bg-black"
              style={{ minHeight: "300px" }}
              data-ocid="videocall.panel"
            >
              {/* Remote video (full area) */}
              {/* biome-ignore lint/a11y/useMediaCaption: live video call stream has no captions */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
                style={{ minHeight: "300px", background: "#111" }}
              />

              {/* Connection status overlay */}
              {!callConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-white font-medium">
                      📹 Connecting...
                    </p>
                  </div>
                </div>
              )}

              {callConnected && (
                <div className="absolute top-3 left-3">
                  <span className="inline-flex items-center gap-1.5 bg-emerald-500/80 text-white text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    Connected
                  </span>
                </div>
              )}

              {/* Local video (PiP, bottom-right) */}
              <div className="absolute bottom-14 right-3 w-[100px] h-[134px] rounded-xl overflow-hidden border-2 border-white/20 shadow-lg">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>

              {/* Mini Translation Chat (floating at bottom of video) */}
              {miniChatMessages.length > 0 && (
                <div className="absolute bottom-16 left-3 right-[120px] max-h-[140px] overflow-y-auto space-y-1.5 pr-1">
                  {miniChatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.speaker === "me" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs backdrop-blur-sm ${
                          msg.speaker === "me"
                            ? "bg-primary/70 text-white"
                            : "bg-black/60 text-white/90 border border-white/10"
                        }`}
                      >
                        {msg.speaker === "me" && msg.originalText && (
                          <p className="text-white/60 text-[10px] italic mb-0.5">
                            {msg.originalText}
                          </p>
                        )}
                        <p>{msg.text}</p>
                        <span className="text-[10px] opacity-60 ml-1">
                          {getLang(msg.langCode).flag}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Video Controls Bar */}
              <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-3 p-2 bg-black/50 backdrop-blur-sm">
                {/* End Call */}
                <button
                  type="button"
                  data-ocid="videocall.delete_button"
                  onClick={endCall}
                  title="End Call"
                  className="w-11 h-11 rounded-full bg-destructive hover:bg-destructive/80 flex items-center justify-center transition-all"
                >
                  <PhoneOff className="w-5 h-5 text-white" />
                </button>

                {/* Mic Mute (WebRTC audio) */}
                <button
                  type="button"
                  data-ocid="videocall.toggle"
                  onClick={toggleVideoMic}
                  title={videoMicMuted ? "Unmute mic" : "Mute mic"}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                    videoMicMuted
                      ? "bg-destructive/80 hover:bg-destructive/60"
                      : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  {videoMicMuted ? (
                    <MicOff className="w-5 h-5 text-white" />
                  ) : (
                    <Mic className="w-5 h-5 text-white" />
                  )}
                </button>

                {/* Camera Toggle */}
                <button
                  type="button"
                  data-ocid="videocall.toggle"
                  onClick={toggleCamera}
                  title={cameraOff ? "Turn on camera" : "Turn off camera"}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                    cameraOff
                      ? "bg-destructive/80 hover:bg-destructive/60"
                      : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  {cameraOff ? (
                    <CameraOff className="w-5 h-5 text-white" />
                  ) : (
                    <Camera className="w-5 h-5 text-white" />
                  )}
                </button>

                {/* T = Translation Mic */}
                <button
                  type="button"
                  data-ocid="videocall.toggle"
                  onClick={toggleVideoTranslationMic}
                  title="Translate voice"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all font-bold text-sm ${
                    isVideoListening
                      ? "bg-emerald-500 animate-mic-pulse shadow-[0_0_20px_rgba(74,222,128,0.4)]"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  {isVideoListening ? (
                    <span className="flex items-center gap-0.5">
                      <WaveBars />
                    </span>
                  ) : (
                    <span className="text-white font-bold text-sm">T</span>
                  )}
                </button>

                {isVideoListening && (
                  <span
                    className={`text-xs tabular-nums ${videoTimerColor} font-medium`}
                  >
                    {videoTimerLabel}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Language Row ── */}
        {!isInVideoCall && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                Meri Bhasha
              </p>
              <Select value={myLang} onValueChange={setMyLang}>
                <SelectTrigger
                  data-ocid="app.select"
                  className="glass border-border/50 rounded-xl h-10 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {LANG_OPTIONS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      <span className="flex items-center gap-2">
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                Unki Bhasha
              </p>
              <Select value={theirLang} onValueChange={setTheirLang}>
                <SelectTrigger
                  data-ocid="app.select"
                  className="glass border-border/50 rounded-xl h-10 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {LANG_OPTIONS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      <span className="flex items-center gap-2">
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* ── Message Area (hidden during active video call) ── */}
        {!isInVideoCall && (
          <div
            ref={scrollRef}
            data-ocid="app.panel"
            className="flex-1 glass rounded-2xl p-4 mb-4 overflow-y-auto space-y-3"
            style={{ minHeight: "240px", maxHeight: "calc(100vh - 420px)" }}
          >
            <AnimatePresence initial={false}>
              {messages.length === 0 && !theyAreSpeaking ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center py-10"
                  data-ocid="app.empty_state"
                >
                  <Mic className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {roomReady
                      ? "Mic dabaao aur bolo"
                      : "Room se connect ho raha hai..."}
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    {roomReady ? "Press mic and speak" : "Please wait..."}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="messages"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {messages.map((msg, i) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        boxShadow: msg.playing
                          ? [
                              "0 0 0px 0px oklch(0.72 0.19 142 / 0)",
                              "0 0 0px 3px oklch(0.72 0.19 142 / 0.5)",
                              "0 0 0px 0px oklch(0.72 0.19 142 / 0)",
                            ]
                          : "0 0 0px 0px transparent",
                      }}
                      transition={{
                        duration: 0.25,
                        boxShadow: msg.playing
                          ? { duration: 1, repeat: 2, ease: "easeInOut" }
                          : { duration: 0.3 },
                      }}
                      data-ocid={`app.item.${i + 1}`}
                      className={`flex mb-3 ${
                        msg.speaker === "me" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                          msg.speaker === "me"
                            ? "msg-me rounded-tr-sm"
                            : `msg-them rounded-tl-sm${
                                msg.playing
                                  ? " ring-2 ring-emerald-400/50 ring-offset-0"
                                  : ""
                              }`
                        }`}
                      >
                        {msg.speaker === "me" && msg.originalText && (
                          <p className="text-xs text-muted-foreground/70 mb-1 italic">
                            {msg.originalText}
                          </p>
                        )}
                        <p className="text-sm leading-relaxed font-medium text-foreground">
                          {msg.text}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-xs">
                            {getLang(msg.langCode).flag}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {getLang(msg.langCode).label}
                          </span>
                          {msg.speaker === "them" &&
                            (msg.playing ? (
                              <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [1, 0.5, 1] }}
                                transition={{
                                  duration: 1,
                                  repeat: Number.POSITIVE_INFINITY,
                                }}
                                className="ml-1 text-xs text-emerald-500 font-medium"
                              >
                                🔔 Playing...
                              </motion.span>
                            ) : (
                              <button
                                type="button"
                                data-ocid="app.secondary_button"
                                title="Replay audio"
                                onClick={() => {
                                  if (!audioUnlockedRef.current) {
                                    toast.warning(
                                      "Pehle 'Enable Audio' dabao 👆",
                                    );
                                    return;
                                  }
                                  enqueueSpeech({
                                    text: msg.text,
                                    ttsLang: getLang(msg.langCode).tts,
                                  });
                                }}
                                className="ml-1 p-0.5 rounded text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Volume2 className="w-3 h-3" />
                              </button>
                            ))}
                          {msg.speaker === "them" &&
                            msg.latencyMs !== undefined && (
                              <LatencyBadge ms={msg.latencyMs} />
                            )}
                          {msg.speaker === "me" && (
                            <span className="ml-auto pl-2">
                              <MessageStatus status={msg.status} />
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  <AnimatePresence>
                    {theyAreSpeaking && <SpeakingIndicator />}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Mic Section (hidden during active video call) ── */}
        {!isInVideoCall && (
          <div className="flex flex-col items-center gap-3">
            {isTranslating && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-muted-foreground flex items-center gap-1.5"
                data-ocid="app.loading_state"
              >
                <span className="w-3 h-3 border border-primary/40 border-t-primary rounded-full animate-spin" />
                Translating...
              </motion.p>
            )}

            {isListening && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2"
              >
                <WaveBars />
                <span className="text-xs text-primary font-medium">
                  {myLangInfo.label} mein sun raha hoon...
                </span>
                <span className={`text-xs tabular-nums ${timerColor}`}>
                  {timerLabel}
                </span>
                <WaveBars />
              </motion.div>
            )}

            {/* Speaker + Mic row */}
            <div className="flex items-center justify-center gap-4">
              {/* Speaker mute toggle */}
              <button
                type="button"
                data-ocid="app.toggle"
                onClick={toggleSpeaker}
                title={speakerMuted ? "Speaker muted" : "Speaker on"}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 border ${
                  speakerMuted
                    ? "bg-destructive/10 border-destructive/40 text-destructive hover:bg-destructive/20"
                    : "bg-muted/50 border-border/50 text-foreground hover:bg-muted"
                }`}
              >
                {speakerMuted ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>

              {/* Mic button */}
              <button
                type="button"
                data-ocid="app.toggle"
                onClick={toggleMic}
                disabled={micDisabled}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isListening
                    ? "bg-destructive animate-mic-pulse shadow-[0_0_40px_oklch(0.58_0.22_25_/_0.4)]"
                    : "bg-primary hover:bg-primary/90 mic-glow hover:mic-glow-active"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isConnecting ? (
                  <Loader2 className="w-8 h-8 text-primary-foreground animate-spin" />
                ) : isListening ? (
                  <MicOff className="w-8 h-8 text-destructive-foreground" />
                ) : (
                  <Mic className="w-8 h-8 text-primary-foreground" />
                )}
              </button>

              {/* Start Video Call button (Person A, idle state) */}
              {myRole === "A" && roomReady && callState === "idle" && (
                <button
                  type="button"
                  data-ocid="videocall.open_modal_button"
                  onClick={startVideoCall}
                  title="Start Video Call"
                  className="w-12 h-12 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-600/40 hover:text-emerald-300 flex items-center justify-center transition-all duration-200"
                >
                  <Video className="w-5 h-5" />
                </button>
              )}

              {/* Phone icon for Person B when idle (visual placeholder) */}
              {myRole === "B" && roomReady && callState === "idle" && (
                <div
                  className="w-12 h-12 rounded-full bg-muted/30 border border-border/30 text-muted-foreground/40 flex items-center justify-center"
                  title="Waiting for call from A"
                >
                  <Phone className="w-5 h-5" />
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {isConnecting
                ? "Room se jud raha hai..."
                : isListening
                  ? `${myLangInfo.flag} Tap to stop`
                  : isTranslating
                    ? "Processing..."
                    : !audioUnlocked
                      ? "⬆️ Pehle Enable Audio dabao"
                      : `${myLangInfo.flag} ${myLangInfo.label} mein bolo`}
            </p>
            <p className="text-xs text-muted-foreground/50 text-center">
              Translates to {theirLangInfo.flag} {theirLangInfo.label}
              {speakerMuted && (
                <span className="ml-1 text-destructive/70">(Speaker off)</span>
              )}
            </p>

            {/* Video call status hint */}
            {myRole === "A" && roomReady && callState === "idle" && (
              <p className="text-xs text-emerald-400/60 text-center">
                📹 Video call ke liye green button dabao
              </p>
            )}
            {myRole === "B" && roomReady && callState === "idle" && (
              <p className="text-xs text-muted-foreground/40 text-center">
                📹 A se video call aane ka intezaar karo
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-6 text-center text-xs text-muted-foreground/40">
          © {new Date().getFullYear()}.{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-muted-foreground transition-colors"
          >
            Built with ♥ using caffeine.ai
          </a>
        </footer>
      </div>
    </>
  );
}
