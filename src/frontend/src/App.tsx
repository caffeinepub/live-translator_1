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
  Check,
  CheckCheck,
  Copy,
  Globe,
  Loader2,
  Mic,
  MicOff,
  Share2,
  Volume2,
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  speaker: "me" | "them";
  text: string;
  originalText?: string;
  langCode: string;
  timestamp: number;
  status?: "sending" | "sent" | "heard";
}

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
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices());
    };
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

async function speak(text: string, ttsLang: string): Promise<void> {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const voices = await getVoices();
  return new Promise((resolve) => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = ttsLang;
    const langPrefix = ttsLang.split("-")[0].toLowerCase();
    const match = voices.find((v) =>
      v.lang.toLowerCase().startsWith(langPrefix),
    );
    if (match) utt.voice = match;
    utt.rate = 0.9;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
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

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { actor, isFetching } = useActor();

  const [myLang, setMyLang] = useState("hi");
  const [theirLang, setTheirLang] = useState("zh");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasOtherSpeaker, setHasOtherSpeaker] = useState(false);
  const [theyAreSpeaking, setTheyAreSpeaking] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const mySessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const lastFetchedCountRef = useRef<bigint>(0n);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const myLangRef = useRef(myLang);
  const theirLangRef = useRef(theirLang);
  const theyAreSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const audioUnlockedRef = useRef(false);
  const roomReadyRef = useRef(false);

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
    (actor as any)
      .ensureRoom(ROOM_ID)
      .then(() => {
        setRoomReady(true);
        roomReadyRef.current = true;
      })
      .catch(() => {
        // Fallback: try joinRoom, or just mark ready
        actor
          .joinRoom(ROOM_ID)
          .catch(() => {})
          .finally(() => {
            setRoomReady(true);
            roomReadyRef.current = true;
          });
      })
      .finally(() => {
        setIsConnecting(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, isFetching]);

  // ─── Audio unlock ──────────────────────────────────────────────────────────
  function unlockAudio() {
    if (audioUnlockedRef.current) return;
    const utt = new SpeechSynthesisUtterance("");
    utt.volume = 0;
    window.speechSynthesis.speak(utt);
    setAudioUnlocked(true);
    audioUnlockedRef.current = true;
  }

  // ─── Polling ───────────────────────────────────────────────────────────────
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
        // Skip our own messages
        if (msg.speaker === myId || msg.speaker === mySysId) continue;

        // Handle system messages
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

        // This is a real message from the OTHER person
        setHasOtherSpeaker(true);
        setTheyAreSpeaking(false);
        if (theyAreSpeakingTimerRef.current)
          clearTimeout(theyAreSpeakingTimerRef.current);

        const langInfo = getLang(msg.languageCode);
        newMsgs.push({
          id: `them-${msg.timestamp.toString()}`,
          speaker: "them",
          text: msg.payload,
          langCode: msg.languageCode,
          timestamp: Number(msg.timestamp),
        });

        // RECEIVER plays the audio - this is the walky-talky behaviour
        speak(msg.payload, langInfo.tts).then(() => {
          if (actor) {
            actor
              .sendToRoom(ROOM_ID, {
                speaker: mySysId,
                languageCode: "sys",
                payload: `__ACK__:${msg.timestamp.toString()}`,
              })
              .catch(() => {});
          }
        });
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

  // Copy share link
  async function copyLink() {
    unlockAudio();
    const link = window.location.href;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copy ho gaya! Share karo.");
    setTimeout(() => setCopied(false), 2000);
  }

  // Mic toggle
  function startListening() {
    unlockAudio();
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

        // DO NOT speak on sender side - only RECEIVER hears the translation
        // This is the walky-talky fix: sender sends, receiver hears

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
    unlockAudio();
    if (isListening) stopListening();
    else startListening();
  }

  const myLangInfo = getLang(myLang);
  const theirLangInfo = getLang(theirLang);
  const micDisabled = isTranslating || isConnecting || !roomReady;

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
                Pehli baar mic dabaane se audio on ho jaata hai
              </p>
              <button
                type="button"
                onClick={unlockAudio}
                className="text-xs font-semibold text-amber-600 dark:text-amber-400 underline shrink-0"
              >
                Enable
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
              {window.location.href}
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

        {/* ── Language Row ── */}
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

        {/* ── Message Area ── */}
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
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    data-ocid={`app.item.${i + 1}`}
                    className={`flex mb-3 ${
                      msg.speaker === "me" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                        msg.speaker === "me"
                          ? "msg-me rounded-tr-sm"
                          : "msg-them rounded-tl-sm"
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
                        {msg.speaker === "them" && (
                          <button
                            type="button"
                            data-ocid="app.secondary_button"
                            title="Replay audio"
                            onClick={() => {
                              unlockAudio();
                              speak(msg.text, getLang(msg.langCode).tts);
                            }}
                            className="ml-1 p-0.5 rounded text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Volume2 className="w-3 h-3" />
                          </button>
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

        {/* ── Mic Section ── */}
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
              <WaveBars />
            </motion.div>
          )}

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

          <p className="text-xs text-muted-foreground text-center">
            {isConnecting
              ? "Room se jud raha hai..."
              : isListening
                ? `${myLangInfo.flag} Tap to stop`
                : isTranslating
                  ? "Processing..."
                  : `${myLangInfo.flag} ${myLangInfo.label} mein bolo`}
          </p>
          <p className="text-xs text-muted-foreground/50 text-center">
            Translates to {theirLangInfo.flag} {theirLangInfo.label}
          </p>
        </div>

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
