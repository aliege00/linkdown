/**
 * AI Assistant chat component powered by Google Gemini.
 *
 * Embeds a conversational UI inside the Help tab so users can ask
 * VidFetch-related questions in natural language (TR / EN).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { streamChat, isGeminiAvailable, type ChatMessage } from "@/lib/gemini";
import { GlassCard } from "@/components/GlassCard";

const SUGGESTIONS_TR = [
  "YouTube'dan MP4 nasıl indiririm?",
  "Hangi format daha iyi: MP4 mü MP3 mü?",
  "İndirme hatası alıyorum — ne yapmalıyım?",
  "TikTok videoları destekleniyor mu?",
];

const SUGGESTIONS_EN = [
  "How do I download YouTube videos as MP4?",
  "Which format is better: MP4 or MP3?",
  "I'm getting a download error — what should I do?",
  "Are TikTok videos supported?",
];

export default function AiAssistant({ lang }: { lang: "tr" | "en" }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<boolean>(false);


  const suggestions = lang === "tr" ? SUGGESTIONS_TR : SUGGESTIONS_EN;
  const placeholder = lang === "tr" ? "Sorunuzu yazın..." : "Type your question...";

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = useCallback(
    async (text?: string) => {
      const question = (text ?? input).trim();
      if (!question || isStreaming) return;

      abortRef.current = false;
      setError(null);
      setInput("");

      const userMsg: ChatMessage = { role: "user", text: question };
      const updated = [...messages, userMsg];
      setMessages(updated);

      // Start streaming the assistant reply
      setIsStreaming(true);
      let accumulated = "";
      const modelMsg: ChatMessage = { role: "model", text: "" };
      setMessages([...updated, modelMsg]);

      try {
        for await (const chunk of streamChat(
          messages, // send full prior history, not including new message (it's passed separately)
          question,
        )) {
          if (abortRef.current) break;
          accumulated += chunk;
          modelMsg.text = accumulated;
          setMessages([...updated, { ...modelMsg }]);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("API key")) {
          setError(
            lang === "tr"
              ? "API anahtarı yapılandırılmamış. Lütfen Keys sekmesinden VITE_GOOGLE_API_KEY ekleyin."
              : "API key not configured. Please add VITE_GOOGLE_API_KEY in the Keys tab.",
          );
        } else {
          setError(
            lang === "tr"
              ? `Hata: ${msg}`
              : `Error: ${msg}`,
          );
        }
        // Remove empty model message on error
        setMessages(updated);
      } finally {
        setIsStreaming(false);
      }
    },
    [input, messages, isStreaming, lang],
  );

  // ── No API key ──
  if (!isGeminiAvailable()) {
    return (
      <div className="rounded-2xl p-4 border border-border/20 bg-white/3 dark:bg-white/[0.01]">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <AlertCircle className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {lang === "tr" ? "AI Asistan — Yapılandırma Gerekli" : "AI Assistant — Setup Required"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              {lang === "tr"
                ? "Gemini AI'ı kullanmak için Keys sekmesinden VITE_GOOGLE_API_KEY ekleyin."
                : "Add VITE_GOOGLE_API_KEY in the Keys tab to use Gemini AI."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <GlassCard interactive className="!p-0 overflow-hidden">
      {/* Chat messages area */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4 space-y-3 max-h-[360px]"
        style={{ touchAction: "pan-y" as const }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-lg shadow-cyan-500/20">
              <Sparkles className="size-6" />
            </div>
            <p className="text-sm font-semibold text-center">
              {lang === "tr" ? "VidFetch AI Asistan" : "VidFetch AI Assistant"}
            </p>
            <p className="text-xs text-muted-foreground text-center max-w-[240px]">
              {lang === "tr"
                ? "İndirme, format veya hata sorularınızı sorun."
                : "Ask questions about downloading, formats, or troubleshooting."}
            </p>
            {/* Suggestion chips */}
            <div className="flex flex-wrap justify-center gap-1.5 mt-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSend(s)}
                  className="px-3 py-1.5 rounded-full text-[10px] font-medium bg-white/8 dark:bg-white/[0.04] border border-border/20 text-muted-foreground hover:bg-white/12 hover:text-foreground transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                  msg.role === "user"
                    ? "bg-violet-500/15 text-violet-400"
                    : "bg-cyan-500/15 text-cyan-400"
                }`}
              >
                {msg.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-violet-500/12 border border-violet-500/20 text-foreground"
                    : "bg-white/5 dark:bg-white/[0.03] border border-border/20 text-foreground"
                }`}
              >
                {msg.text || (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {lang === "tr" ? "Düşünüyor..." : "Thinking..."}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-2 p-3 border-t border-border/10">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          disabled={isStreaming}
          className="flex-1 bg-transparent outline-none text-xs placeholder:text-muted-foreground/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={!input.trim() || isStreaming}
          className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-md shadow-cyan-500/20 disabled:opacity-40 transition-opacity cursor-pointer"
        >
          {isStreaming ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
        </button>
      </div>
    </GlassCard>
  );
}
