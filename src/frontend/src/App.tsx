import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  ArrowRight,
  Check,
  Copy,
  Globe,
  Link2,
  Mic,
  MicOff,
  Users,
  Volume2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { backendInterface } from "./backend";
import { useActor } from "./hooks/useActor";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "home" | "room";

interface ChatMessage {
  id: string;
  speaker: "me" | "them";
  text: string;
  langCode: string;
  timestamp: number;
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

// ─── Speak helper ─────────────────────────────────────────────────────────────

function speak(text: string, ttsLang: string) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = ttsLang;
  window.speechSynthesis.speak(utt);
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

interface HomeProps {
  actor: backendInterface | null;
  onCreated: (roomId: string) => void;
  onJoined: (roomId: string) => void;
  prefillRoom?: string;
}

function HomeScreen({ actor, onCreated, onJoined, prefillRoom }: HomeProps) {
  const [joinCode, setJoinCode] = useState(prefillRoom ?? "");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  async function handleCreate() {
    if (!actor) return;
    setCreating(true);
    try {
      const roomId = await actor.createRoom();
      onCreated(roomId);
    } catch {
      toast.error("Could not create room. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin() {
    if (!actor) return;
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true);
    try {
      const ok = await actor.joinRoom(code);
      if (!ok) {
        toast.error("Room not found. Check the code and try again.");
        return;
      }
      onJoined(code);
    } catch {
      toast.error("Could not join room. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-accent/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 mb-4"
          >
            <Globe className="w-8 h-8 text-primary" />
          </motion.div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            vormo
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Real-time 2-way translation calls
          </p>
        </div>

        {/* Start card */}
        <div className="glass rounded-2xl p-6 mb-4 shadow-card">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
            Start a conversation
          </h2>
          <Button
            data-ocid="home.primary_button"
            onClick={handleCreate}
            disabled={creating || !actor}
            className="w-full h-12 text-base font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Start a Conversation
                <ArrowRight className="w-4 h-4 ml-auto" />
              </span>
            )}
          </Button>
        </div>

        {/* Join card */}
        <div className="glass rounded-2xl p-6 shadow-card">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
            Join a room
          </h2>
          <div className="flex gap-2">
            <Input
              data-ocid="home.input"
              placeholder="Enter room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              className="flex-1 h-10 bg-muted border-border rounded-xl text-sm"
            />
            <Button
              data-ocid="home.submit_button"
              onClick={handleJoin}
              disabled={joining || !joinCode.trim() || !actor}
              className="h-10 px-4 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              {joining ? (
                <span className="w-4 h-4 border-2 border-secondary-foreground/30 border-t-secondary-foreground rounded-full animate-spin" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Footer */}
      <footer className="mt-12 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()}.{" "}
        <a
          href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Built with ♥ using caffeine.ai
        </a>
      </footer>
    </div>
  );
}

// ─── Wave animation bars ──────────────────────────────────────────────────────

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

// ─── Room Screen ──────────────────────────────────────────────────────────────

interface RoomProps {
  actor: backendInterface | null;
  roomId: string;
  isCreator: boolean;
  onLeave: () => void;
}

function RoomScreen({ actor, roomId, isCreator, onLeave }: RoomProps) {
  const [myLang, setMyLang] = useState(isCreator ? "hi" : "en");
  const [theirLang, setTheirLang] = useState(isCreator ? "en" : "hi");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasOtherSpeaker, setHasOtherSpeaker] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const lastSeenIdRef = useRef<bigint>(0n);
  // biome-ignore lint/suspicious/noExplicitAny: SpeechRecognition not universally typed
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const myLangRef = useRef(myLang);
  const theirLangRef = useRef(theirLang);

  // Keep refs in sync
  useEffect(() => {
    myLangRef.current = myLang;
  }, [myLang]);
  useEffect(() => {
    theirLangRef.current = theirLang;
  }, [theirLang]);

  // Auto scroll to bottom
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll on messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Polling for incoming messages
  const poll = useCallback(async () => {
    if (!actor) return;
    try {
      const fetched = await actor.fetchMessagesSinceForRoomId(
        roomId,
        lastSeenIdRef.current,
      );
      if (fetched.length === 0) return;

      const newMsgs: ChatMessage[] = [];
      let maxId = lastSeenIdRef.current;

      for (const msg of fetched) {
        if (msg.speaker === "me") continue;
        setHasOtherSpeaker(true);

        const langInfo = getLang(msg.languageCode);
        newMsgs.push({
          id: `${msg.speaker}-${msg.timestamp.toString()}`,
          speaker: "them",
          text: msg.payload,
          langCode: msg.languageCode,
          timestamp: Number(msg.timestamp),
        });

        speak(msg.payload, langInfo.tts);

        if (msg.timestamp > maxId) maxId = msg.timestamp;
      }

      if (newMsgs.length > 0) {
        setMessages((prev) => [...prev, ...newMsgs]);
        lastSeenIdRef.current = maxId;
      }
    } catch {
      // silent poll failure
    }
  }, [actor, roomId]);

  useEffect(() => {
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [poll]);

  // Copy link
  async function copyLink() {
    const link = `${window.location.origin}?room=${roomId}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copied! Share it with the other person.");
    setTimeout(() => setCopied(false), 2000);
  }

  // Mic
  function startListening() {
    // biome-ignore lint/suspicious/noExplicitAny: SpeechRecognition vendor prefix
    const w = window as any;
    const SRCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SRCtor) {
      toast.error("Speech recognition not supported in this browser.");
      return;
    }
    const rec = new SRCtor();
    rec.lang = getLang(myLangRef.current).tts;
    rec.interimResults = false;
    rec.continuous = false;

    rec.onresult = async (event) => {
      const spoken = event.results[0][0].transcript;
      setIsListening(false);
      setIsTranslating(true);

      try {
        const translated = await translateText(
          spoken,
          myLangRef.current,
          theirLangRef.current,
        );
        const myMsg: ChatMessage = {
          id: `me-${Date.now()}`,
          speaker: "me",
          text: translated,
          langCode: theirLangRef.current,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, myMsg]);

        if (actor) {
          await actor.sendToRoom(roomId, {
            speaker: "me",
            languageCode: theirLangRef.current,
            payload: translated,
          });
        }
      } catch {
        toast.error("Translation failed. Please try again.");
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

  const myLangInfo = getLang(myLang);
  const theirLangInfo = getLang(theirLang);

  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto px-4 py-4">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          <span className="font-bold text-lg tracking-tight">vormo</span>
        </div>
        <div className="flex items-center gap-2">
          {hasOtherSpeaker ? (
            <Badge
              variant="outline"
              className="gap-1.5 text-xs border-accent/50 text-accent"
            >
              <Wifi className="w-3 h-3" />
              Connected
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1.5 text-xs border-muted-foreground/30 text-muted-foreground"
            >
              <WifiOff className="w-3 h-3" />
              Waiting...
            </Badge>
          )}
          <Button
            data-ocid="room.secondary_button"
            variant="ghost"
            size="sm"
            onClick={onLeave}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Leave
          </Button>
        </div>
      </header>

      {/* Room code bar */}
      <div className="glass rounded-xl px-4 py-3 flex items-center justify-between mb-4 relative z-10">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Room Code
          </p>
          <p className="font-mono font-bold text-sm text-foreground mt-0.5">
            {roomId}
          </p>
        </div>
        <Button
          data-ocid="room.primary_button"
          variant="ghost"
          size="sm"
          onClick={copyLink}
          className="gap-1.5 text-xs text-primary hover:text-primary/80"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? "Copied!" : "Copy Link"}
        </Button>
      </div>

      {/* Language selectors */}
      <div className="grid grid-cols-2 gap-3 mb-4 relative z-10">
        <div>
          <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">
            My Language
          </p>
          <Select value={myLang} onValueChange={setMyLang}>
            <SelectTrigger
              data-ocid="room.select"
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
          <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">
            Their Language
          </p>
          <Select value={theirLang} onValueChange={setTheirLang}>
            <SelectTrigger
              data-ocid="room.select"
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

      {/* Chat area */}
      <div
        ref={scrollRef}
        data-ocid="room.panel"
        className="flex-1 overflow-y-auto glass rounded-2xl p-4 mb-4 min-h-[240px] max-h-[320px] space-y-3 relative z-10"
      >
        <AnimatePresence initial={false}>
          {messages.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex flex-col items-center justify-center text-center py-8"
              data-ocid="room.empty_state"
            >
              <Globe className="w-8 h-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                {hasOtherSpeaker
                  ? "Start speaking to translate!"
                  : "Share the link, then press the mic to start"}
              </p>
            </motion.div>
          ) : (
            messages.map((msg, i) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                data-ocid={`room.item.${i + 1}`}
                className={`flex ${
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
                  <p className="text-sm leading-relaxed text-foreground">
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
                      <Volume2 className="w-3 h-3 text-muted-foreground ml-1" />
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Mic + status */}
      <div className="flex flex-col items-center gap-3 relative z-10 pb-4">
        {isTranslating && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-muted-foreground flex items-center gap-1.5"
            data-ocid="room.loading_state"
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
            <span className="text-xs text-primary">
              Listening in {myLangInfo.label}...
            </span>
            <WaveBars />
          </motion.div>
        )}

        <button
          type="button"
          data-ocid="room.toggle"
          onClick={toggleMic}
          disabled={isTranslating}
          className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
            isListening
              ? "bg-destructive animate-mic-pulse shadow-[0_0_40px_oklch(0.58_0.22_25_/_0.4)]"
              : "bg-primary hover:bg-primary/90 mic-glow hover:mic-glow-active"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isListening ? (
            <MicOff className="w-8 h-8 text-destructive-foreground" />
          ) : (
            <Mic className="w-8 h-8 text-primary-foreground" />
          )}
        </button>

        <p className="text-xs text-muted-foreground text-center">
          {isListening
            ? "Tap to stop"
            : isTranslating
              ? "Processing..."
              : `Tap to speak in ${myLangInfo.flag} ${myLangInfo.label}`}
        </p>

        <p className="text-xs text-muted-foreground/60 text-center">
          Translates to {theirLangInfo.flag} {theirLangInfo.label}
        </p>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const { actor } = useActor();
  const [view, setView] = useState<View>("home");
  const [roomId, setRoomId] = useState("");
  const [isCreator, setIsCreator] = useState(false);

  const prefillRoom =
    new URLSearchParams(window.location.search).get("room") ?? undefined;

  function handleCreated(id: string) {
    setRoomId(id);
    setIsCreator(true);
    setView("room");
  }

  function handleJoined(id: string) {
    setRoomId(id);
    setIsCreator(false);
    setView("room");
  }

  function handleLeave() {
    setView("home");
    setRoomId("");
    setIsCreator(false);
  }

  return (
    <>
      <Toaster position="top-center" />
      <AnimatePresence mode="wait">
        {view === "home" ? (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <HomeScreen
              actor={actor}
              onCreated={handleCreated}
              onJoined={handleJoined}
              prefillRoom={prefillRoom}
            />
          </motion.div>
        ) : (
          <motion.div
            key="room"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <RoomScreen
              actor={actor}
              roomId={roomId}
              isCreator={isCreator}
              onLeave={handleLeave}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
