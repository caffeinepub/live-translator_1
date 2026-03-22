import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Copy,
  Globe,
  Languages,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi", flag: "🇮🇳" },
  { code: "zh", label: "Chinese", flag: "🇨🇳" },
];

const LANG_TTS_MAP: Record<string, string> = {
  en: "en-US",
  hi: "hi-IN",
  zh: "zh-CN",
};

const MAX_CHARS = 1000;

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

export default function App() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [fromLang, setFromLang] = useState("hi");
  const [toLang, setToLang] = useState("zh");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;
  const toLangRef = useRef(toLang);
  toLangRef.current = toLang;

  const speakText = useCallback((text: string, lang: string) => {
    if (!text) return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = LANG_TTS_MAP[lang] || "en-US";
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);
    speechSynthesis.speak(utter);
  }, []);

  const translateAndMaybeSpeak = useCallback(
    async (
      text: string,
      from: string,
      to: string,
      shouldAutoSpeak: boolean,
    ) => {
      if (!text.trim()) return;
      if (from === to) {
        setOutputText(text);
        if (shouldAutoSpeak) speakText(text, to);
        return;
      }
      setIsTranslating(true);
      setError(null);
      setOutputText("");
      try {
        const res = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`,
        );
        const data = await res.json();
        if (data.responseStatus === 200 && data.responseData?.translatedText) {
          const translated = data.responseData.translatedText as string;
          setOutputText(translated);
          if (shouldAutoSpeak) speakText(translated, to);
        } else {
          throw new Error(data.responseDetails || "Translation failed");
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Translation failed. Please try again.";
        setError(msg);
        toast.error(msg);
      } finally {
        setIsTranslating(false);
      }
    },
    [speakText],
  );

  const handleTranslate = useCallback(async () => {
    const text = inputText.trim();
    if (!text) {
      toast.error("Please enter some text to translate.");
      return;
    }
    await translateAndMaybeSpeak(text, fromLang, toLang, false);
  }, [inputText, fromLang, toLang, translateAndMaybeSpeak]);

  const handleSwap = () => {
    setFromLang(toLang);
    setToLang(fromLang);
    setInputText(outputText);
    setOutputText(inputText);
  };

  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVoiceInput = () => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast.error("Voice input is not supported in your browser.");
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognitionAPI() as SpeechRecognitionInstance;
    recognitionRef.current = recognition;
    recognition.lang = LANG_TTS_MAP[fromLang] || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInputText(transcript);
      setIsListening(false);
      // Capture refs at call time to avoid stale closure
      const shouldAutoSpeak = autoSpeakRef.current;
      const targetLang = toLangRef.current;
      const sourceLang = fromLang;
      if (shouldAutoSpeak) {
        translateAndMaybeSpeak(transcript, sourceLang, targetLang, true);
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
      toast.error("Voice recognition failed. Please try again.");
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const currentFromLang = LANGUAGES.find((l) => l.code === fromLang);
  const currentToLang = LANGUAGES.find((l) => l.code === toLang);

  return (
    <div className="min-h-screen bg-background font-inter">
      <Toaster position="top-center" />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-card/90 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Globe className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">
                LinguaLive
              </span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              {["Features", "Live Translate", "How It Works"].map((link) => (
                <a
                  key={link}
                  href={`#${link.toLowerCase().replace(/ /g, "-")}`}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-ocid={`nav.${link.toLowerCase().replace(/ /g, "_")}.link`}
                >
                  {link}
                </a>
              ))}
            </div>
            <Button
              className="rounded-full px-5 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
              data-ocid="nav.get_started.button"
              onClick={() =>
                document
                  .getElementById("live-translate")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="inline-flex items-center gap-2 bg-secondary text-secondary-foreground rounded-full px-4 py-1.5 text-xs font-semibold mb-6">
              <Zap className="w-3.5 h-3.5" />
              Instant AI-powered translation
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-foreground leading-tight mb-6">
              Communicate <span className="text-primary">Universally</span> with
              Instant Translation
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg">
              Break language barriers instantly. Translate between English,
              Hindi, and Chinese with just a click — or use your voice.
            </p>
            <Button
              size="lg"
              className="rounded-full px-8 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-card"
              onClick={() =>
                document
                  .getElementById("live-translate")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              data-ocid="hero.try_now.button"
            >
              Try Now <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
            className="hidden lg:block"
          >
            <div className="bg-card rounded-2xl shadow-card p-6 border border-border">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-destructive/60" />
                <div className="w-3 h-3 rounded-full bg-chart-4" />
                <div className="w-3 h-3 rounded-full bg-chart-2" />
                <span className="ml-2 text-xs text-muted-foreground font-medium">
                  Live Translation
                </span>
              </div>
              <div className="space-y-3">
                {[
                  {
                    from: "Hello, how are you?",
                    to: "नमस्ते, आप कैसे हैं?",
                    flags: "🇬🇧 → 🇮🇳",
                  },
                  { from: "Good morning!", to: "早上好！", flags: "🇬🇧 → 🇨🇳" },
                  {
                    from: "मुझे यात्रा करना पसंद है",
                    to: "I love to travel",
                    flags: "🇮🇳 → 🇬🇧",
                  },
                ].map((item, i) => (
                  <motion.div
                    key={item.from}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.15 }}
                    className="bg-background rounded-xl p-3 border border-border"
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      {item.flags}
                    </div>
                    <div className="text-sm font-medium text-foreground mb-1">
                      {item.from}
                    </div>
                    <div className="text-sm text-primary font-semibold">
                      {item.to}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Translator Panel */}
      <section
        id="live-translate"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">
            Live Translator
          </h2>
          <p className="text-muted-foreground">
            Type or speak your text and get instant translations
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-card rounded-2xl shadow-card border border-border overflow-hidden"
        >
          {/* Language Bar */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border px-6 py-4 bg-background/60">
            <Select value={fromLang} onValueChange={setFromLang}>
              <SelectTrigger
                className="w-full max-w-[200px] rounded-full border-border"
                data-ocid="translator.from_lang.select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    <span className="mr-2">{l.flag}</span>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={handleSwap}
              className="w-10 h-10 rounded-full border border-border bg-card hover:bg-secondary flex items-center justify-center transition-all hover:scale-110 active:scale-95"
              aria-label="Swap languages"
              data-ocid="translator.swap.button"
            >
              <ArrowLeftRight className="w-4 h-4 text-primary" />
            </button>

            <div className="flex justify-end">
              <Select value={toLang} onValueChange={setToLang}>
                <SelectTrigger
                  className="w-full max-w-[200px] rounded-full border-border"
                  data-ocid="translator.to_lang.select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      <span className="mr-2">{l.flag}</span>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Translation Body */}
          <div className="grid lg:grid-cols-[1fr_auto_1fr]">
            {/* Source */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <span>{currentFromLang?.flag}</span> Your Text
                </span>
                <span
                  className={`text-xs ${
                    inputText.length > MAX_CHARS * 0.9
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {inputText.length}/{MAX_CHARS}
                </span>
              </div>
              <Textarea
                value={inputText}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_CHARS)
                    setInputText(e.target.value);
                }}
                placeholder="Type your text here..."
                className="min-h-[180px] resize-none border-border focus:ring-primary text-base"
                data-ocid="translator.source.textarea"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                    handleTranslate();
                }}
              />
            </div>

            {/* Center Actions */}
            <div className="flex flex-col items-center justify-center gap-4 px-4 py-6 lg:border-x border-border bg-background/40">
              <Button
                onClick={handleTranslate}
                disabled={isTranslating || !inputText.trim()}
                className="rounded-xl px-6 py-2.5 font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 w-full lg:w-auto"
                data-ocid="translator.translate.button"
              >
                {isTranslating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />{" "}
                    Translating...
                  </>
                ) : (
                  <>
                    <Languages className="w-4 h-4 mr-2" /> Translate
                  </>
                )}
              </Button>

              {/* Mic + Auto-Speak */}
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={handleVoiceInput}
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-card ${
                    isListening
                      ? "bg-destructive text-white animate-pulse-ring"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-95"
                  }`}
                  aria-label={
                    isListening ? "Stop listening" : "Start voice input"
                  }
                  data-ocid="translator.voice.button"
                >
                  {isListening ? (
                    <MicOff className="w-7 h-7" />
                  ) : (
                    <Mic className="w-7 h-7" />
                  )}
                </button>
                <span className="text-xs text-muted-foreground font-medium">
                  {isListening ? "Listening..." : "Voice Input"}
                </span>

                {/* Auto-Speak Toggle */}
                <button
                  type="button"
                  onClick={() => setAutoSpeak((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    autoSpeak
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                  aria-label="Toggle Auto-Speak"
                  data-ocid="translator.autospeak.toggle"
                >
                  <motion.span
                    animate={
                      autoSpeak ? { rotate: [0, -10, 10, -8, 8, 0] } : {}
                    }
                    transition={{ duration: 0.5 }}
                  >
                    🔊
                  </motion.span>
                  <span>Auto-Speak</span>
                  <span
                    className={`w-2 h-2 rounded-full inline-block transition-colors ${
                      autoSpeak ? "bg-primary" : "bg-muted-foreground/40"
                    }`}
                  />
                </button>
                <span className="text-xs text-muted-foreground/70 text-center leading-tight max-w-[100px]">
                  {autoSpeak ? "आटो बोलें: चालू" : "आटो बोलें: बंद"}
                </span>
              </div>
            </div>

            {/* Output */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <span>{currentToLang?.flag}</span> Translation
                  {/* Speaking indicator */}
                  <AnimatePresence>
                    {isSpeaking && (
                      <motion.span
                        key="speaking-badge"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="ml-1 inline-flex items-center gap-1 bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium"
                        data-ocid="translator.speaking.loading_state"
                      >
                        <motion.span
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{
                            repeat: Number.POSITIVE_INFINITY,
                            duration: 0.8,
                          }}
                        >
                          🔊
                        </motion.span>
                        Speaking...
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!outputText}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Copy translation"
                  data-ocid="translator.copy.button"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-primary" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
              <div
                className="min-h-[180px] rounded-lg border border-border bg-background/60 p-3 text-base"
                data-ocid="translator.output.panel"
              >
                <AnimatePresence mode="wait">
                  {isTranslating ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 text-muted-foreground h-full pt-2"
                      data-ocid="translator.loading_state"
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Translating...
                    </motion.div>
                  ) : error ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-destructive text-sm pt-2"
                      data-ocid="translator.error_state"
                    >
                      {error}
                    </motion.div>
                  ) : outputText ? (
                    <motion.p
                      key="output"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-foreground leading-relaxed"
                      data-ocid="translator.success_state"
                    >
                      {outputText}
                    </motion.p>
                  ) : (
                    <motion.p
                      key="placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-muted-foreground/60 pt-2 text-sm italic"
                    >
                      Translation will appear here...
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              {outputText && (
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => speakText(outputText, toLang)}
                  data-ocid="translator.speak_output.button"
                >
                  <Volume2 className="w-3.5 h-3.5" /> Listen
                </button>
              )}
            </div>
          </div>

          <div className="px-6 py-3 border-t border-border bg-background/40 text-xs text-muted-foreground">
            Tip: Press{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono">
              Ctrl+Enter
            </kbd>{" "}
            to translate quickly. Enable{" "}
            <span className="font-semibold text-foreground">Auto-Speak</span> to
            hear translations automatically after voice input.
          </div>
        </motion.div>
      </section>

      {/* Supported Languages */}
      <section
        id="features"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold text-foreground mb-2">
            Supported Languages
          </h2>
          <p className="text-muted-foreground">
            Seamlessly translate between these languages
          </p>
        </motion.div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              flag: "🇬🇧",
              name: "English",
              desc: "The world's most widely spoken language",
              native: "English",
              speakers: "1.5B speakers",
            },
            {
              flag: "🇮🇳",
              name: "Hindi",
              desc: "Official language of India, spoken by millions",
              native: "हिंदी",
              speakers: "600M speakers",
            },
            {
              flag: "🇨🇳",
              name: "Chinese",
              desc: "Most spoken language by native speakers globally",
              native: "中文",
              speakers: "1.1B speakers",
            },
          ].map((lang, i) => (
            <motion.div
              key={lang.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-card rounded-2xl border border-border p-6 text-center shadow-xs hover:shadow-card-hover transition-shadow group"
              data-ocid={`language.card.${i + 1}`}
            >
              <div className="text-5xl mb-4">{lang.flag}</div>
              <h3 className="text-lg font-bold text-foreground mb-0.5">
                {lang.name}
              </h3>
              <p className="text-sm text-primary font-medium mb-2">
                {lang.native}
              </p>
              <p className="text-sm text-muted-foreground mb-3">{lang.desc}</p>
              <span className="inline-block bg-secondary text-secondary-foreground text-xs rounded-full px-3 py-1 font-medium">
                {lang.speakers}
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-card border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-foreground mb-2">
              How It Works
            </h2>
            <p className="text-muted-foreground">
              Three simple steps to instant translation
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-10 left-1/3 right-1/3 h-0.5 bg-border" />
            {[
              {
                step: "01",
                icon: "✍️",
                title: "Enter Text",
                desc: "Type or use voice input to enter the text you want to translate in any supported language.",
              },
              {
                step: "02",
                icon: "🌐",
                title: "Choose Language",
                desc: "Select your source and target languages from the dropdown menus. Swap them in one click.",
              },
              {
                step: "03",
                icon: "✨",
                title: "Get Translation",
                desc: "Click Translate and receive your accurate translation instantly. Copy or listen to the result.",
              },
            ].map((step, i) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="flex flex-col items-center text-center"
                data-ocid={`how_it_works.step.${i + 1}`}
              >
                <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center text-3xl mb-4 border-4 border-background shadow-xs relative z-10">
                  {step.icon}
                </div>
                <div className="text-xs font-bold text-primary mb-1 tracking-widest">
                  {step.step}
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-footer text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
                  <Globe className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-lg">LinguaLive</span>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">
                Breaking language barriers with instant, accurate translations
                powered by modern web technology.
              </p>
            </div>
            {[
              {
                heading: "Product",
                links: ["Features", "How It Works", "Languages", "API"],
              },
              {
                heading: "Company",
                links: ["About", "Blog", "Careers", "Press"],
              },
              {
                heading: "Support",
                links: ["Help Center", "Privacy", "Terms", "Contact"],
              },
            ].map((col) => (
              <div key={col.heading}>
                <h4 className="font-semibold text-sm mb-3 text-white/80 tracking-wide">
                  {col.heading}
                </h4>
                <ul className="space-y-2">
                  {col.links.map((link) => (
                    <li key={link}>
                      <span className="text-sm text-white/50 hover:text-white transition-colors cursor-pointer">
                        {link}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/40">
              © {new Date().getFullYear()}. Built with ❤️ using{" "}
              <a
                href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white/70 transition-colors"
              >
                caffeine.ai
              </a>
            </p>
            <div className="flex items-center gap-4 text-xs text-white/40">
              <span>Translate anywhere, anytime.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
