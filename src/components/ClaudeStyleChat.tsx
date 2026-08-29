/**
 * ClaudeStyleChat — A full-page Claude-like AI chat interface.
 *
 * Features:
 * - Left sidebar with conversation history
 * - Centered chat area with streaming responses
 * - Markdown rendering for AI replies
 * - Copy message, new chat, delete conversation
 * - localStorage persistence
 * - Responsive: sidebar collapses on mobile
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Bot,
  User,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Menu,
  X,
  AlertCircle,
  ChevronLeft,
} from "lucide-react";
import {
  streamChat,
  isGeminiAvailable,
  type ChatMessage,
} from "@/lib/gemini";
import { renderMarkdown } from "@/lib/markdown";

/* ── Types ────────────────────────────────────────────────────── */

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/* ── LocalStorage helpers ─────────────────────────────────────── */

const STORAGE_KEY = "vidfetch.claudeConversations";

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(convs: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
  } catch { /* noop */ }
}

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "Yeni Sohbet",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Yeni Sohbet";
  const t = first.text.slice(0, 40);
  return t.length < first.text.length ? t + "…" : t;
}

/* ── Main Component ───────────────────────────────────────────── */

export default function ClaudeStyleChat() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(() => {
    const loaded = loadConversations();
    return loaded[0]?.id ?? null;
  });
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  // Persist
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // ── Create new conversation ──
  const handleNewChat = useCallback(() => {
    const conv = createConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setError(null);
    setSidebarOpen(false);
  }, []);

  // ── Delete conversation ──
  const handleDelete = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  }, [activeId]);

  // ── Send message ──
  const handleSend = useCallback(
    async (text?: string) => {
      const question = (text ?? input).trim();
      if (!question || isStreaming) return;

      setError(null);
      setInput("");

      // Ensure conversation exists
      let convId = activeId;
      let convList = conversations;

      if (!convId || !convList.find((c) => c.id === convId)) {
        const conv = createConversation();
        convList = [conv, ...convList];
        convId = conv.id;
        setConversations(convList);
        setActiveId(convId);
      }

      const userMsg: ChatMessage = { role: "user", text: question };

      // Add user message + empty model message
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                title: deriveTitle([...c.messages, userMsg]),
                messages: [...c.messages, userMsg, { role: "model", text: "" }],
                updatedAt: Date.now(),
              }
            : c,
        ),
      );

      // Stream response
      abortRef.current = false;
      setIsStreaming(true);

      // Get updated conversation to read prior history
      const currentConv = convList.find((c) => c.id === convId) ?? { messages: [] };

      try {
        for await (const chunk of streamChat(currentConv.messages, question)) {
          if (abortRef.current) break;

          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const msgs = [...c.messages];
              const last = msgs[msgs.length - 1];
              if (last?.role === "model") {
                msgs[msgs.length - 1] = { ...last, text: last.text + chunk };
              }
              return { ...c, messages: msgs, updatedAt: Date.now() };
            }),
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("API key")) {
          setError("API anahtarı yapılandırılmamış. Keys sekmesinden VITE_GOOGLE_API_KEY ekleyin.");
        } else {
          setError(`Hata: ${msg}`);
        }
        // Remove empty model message on error
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const msgs = c.messages.filter(
              (m, i) => !(m.role === "model" && m.text === "" && i === c.messages.length - 1),
            );
            return { ...c, messages: msgs };
          }),
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [input, conversations, activeId, isStreaming],
  );

  // ── Copy message ──
  const copyText = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
  }, []);

  // ── No API key ──
  if (!isGeminiAvailable()) {
    return (
      <div className="min-h-screen flex flex-col bg-[#1a1a2e] text-white">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            <ChevronLeft className="size-4" />
            Geri
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-amber-400" />
            <span className="text-sm font-semibold">VidFetch AI</span>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center space-y-4">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <AlertCircle className="size-8" />
            </div>
            <h2 className="text-lg font-bold">API Anahtarı Gerekli</h2>
            <p className="text-sm text-white/50 leading-relaxed">
              Gemini AI&apos;ı kullanmak için Keys sekmesinden{" "}
              <code className="px-1.5 py-0.5 rounded bg-white/10 text-amber-400 text-xs">VITE_GOOGLE_API_KEY</code>{" "}
              ekleyin.
            </p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Sparkles className="size-4" />
              Ücretsiz API Key Al
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#1a1a2e] text-white" style={{ touchAction: "pan-y" }}>
      {/* ═══ Sidebar ═══ */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 bg-[#16162a] border-r border-white/8
          flex flex-col transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:relative md:translate-x-0
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-400" />
            <span className="text-sm font-bold">VidFetch AI</span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* New chat button */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-white/10 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Plus className="size-4" />
            Yeni Sohbet
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5" style={{ touchAction: "pan-y" }}>
          {conversations.length === 0 && (
            <p className="text-xs text-white/30 text-center py-8">Henüz sohbet yok</p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                conv.id === activeId
                  ? "bg-white/10 text-white"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              }`}
              onClick={() => {
                setActiveId(conv.id);
                setSidebarOpen(false);
              }}
            >
              <MessageSquare className="size-3.5 shrink-0 opacity-50" />
              <span className="flex-1 text-xs truncate">{conv.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition-all"
              >
                <Trash2 className="size-3 text-red-400/60" />
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar footer */}
        <div className="px-3 py-3 border-t border-white/8">
          <div className="text-[10px] text-white/25 text-center">Gemini 2.0 Flash · Ücretsiz</div>
        </div>
      </aside>

      {/* Sidebar backdrop (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ═══ Main Chat Area ═══ */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Chat header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#1a1a2e]/90 backdrop-blur-sm shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 rounded-xl hover:bg-white/10 transition-colors"
          >
            <Menu className="size-5 text-white/60" />
          </button>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="hidden md:flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            <ChevronLeft className="size-4" />
            Geri
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors"
          >
            <Plus className="size-3.5" />
            Yeni
          </button>
        </header>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ touchAction: "pan-y" }}
        >
          {messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full px-6 pb-24">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-xl shadow-cyan-500/20 mb-4">
                <Sparkles className="size-7" />
              </div>
              <h2 className="text-lg font-bold text-white/90 mb-1">VidFetch AI&apos;ye Hoş Geldiniz</h2>
              <p className="text-sm text-white/40 text-center max-w-sm mb-6">
                Video indirme, format seçimi veya hata çözümü hakkında sorularınızı sorun.
              </p>
              {/* Suggestion chips */}
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {[
                  "YouTube'dan MP4 nasıl indiririm?",
                  "MP4 mü MP3 mü daha iyi?",
                  "Hangi platformlar destekleniyor?",
                  "İndirme hatası alıyorum",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSend(s)}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((msg, i) => (
                <motion.div
                  key={`${activeId}-${i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  {/* Avatar */}
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5 ${
                      msg.role === "user"
                        ? "bg-violet-500/20 text-violet-400"
                        : "bg-gradient-to-br from-cyan-400 to-violet-500 text-white"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <User className="size-4" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                  </div>

                  {/* Content */}
                  <div className={`flex-1 min-w-0 ${msg.role === "user" ? "flex flex-col items-end" : ""}`}>
                    {/* Role label */}
                    <p className={`text-[10px] font-medium mb-1.5 ${msg.role === "user" ? "text-violet-400/60" : "text-cyan-400/60"}`}>
                      {msg.role === "user" ? "Siz" : "VidFetch AI"}
                    </p>

                    {/* Message body */}
                    <div
                      className={`relative rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-full ${
                        msg.role === "user"
                          ? "bg-violet-500/15 border border-violet-500/20 text-white/90 rounded-tr-sm"
                          : "bg-white/5 border border-white/8 text-white/85 rounded-tl-sm"
                      }`}
                    >
                      {msg.role === "model" ? (
                        <div
                          className="prose-chat"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      )}

                      {/* Streaming cursor */}
                      {msg.role === "model" && isStreaming && i === messages.length - 1 && !msg.text && (
                        <span className="inline-flex items-center gap-1.5 text-white/40">
                          <Loader2 className="size-3.5 animate-spin" />
                          Düşünüyor…
                        </span>
                      )}

                      {/* Copy button (model messages only) */}
                      {msg.role === "model" && msg.text && !isStreaming && (
                        <CopyButton text={msg.text} />
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mx-4 mb-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-xs text-red-400 flex items-center gap-2"
            >
              <AlertCircle className="size-3.5 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══ Input Area ═══ */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="max-w-3xl mx-auto">
            <div
              className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-all focus-within:border-cyan-500/40 focus-within:bg-white/8"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Mesajınızı yazın…"
                rows={1}
                disabled={isStreaming}
                className="flex-1 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 resize-none min-h-[20px] max-h-[120px] disabled:opacity-50"
                style={{ touchAction: "pan-y" }}
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || isStreaming}
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/20 disabled:opacity-30 transition-opacity cursor-pointer hover:scale-105 active:scale-95"
              >
                {isStreaming ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-white/20 text-center mt-2">
              VidFetch AI · Gemini 2.0 Flash · Yanlış bilgi verebilir
            </p>
          </div>
        </div>
      </div>

      {/* ═══ Markdown Styles (injected) ═══ */}
      <style>{`
        .code-block {
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 12px 16px;
          font-size: 12px;
          line-height: 1.6;
          overflow-x: auto;
          margin: 8px 0;
          font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
          color: rgba(255,255,255,0.85);
        }
        .inline-code {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          padding: 1px 5px;
          font-size: 12px;
          font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
          color: #67e8f9;
        }
        .md-h1 { font-size: 18px; font-weight: 700; margin: 16px 0 8px; color: rgba(255,255,255,0.95); }
        .md-h2 { font-size: 15px; font-weight: 700; margin: 14px 0 6px; color: rgba(255,255,255,0.9); }
        .md-h3 { font-size: 13px; font-weight: 600; margin: 12px 0 4px; color: rgba(255,255,255,0.85); }
        .md-ul, .md-ol { margin: 6px 0; padding-left: 20px; }
        .md-li, .md-oli { margin: 3px 0; font-size: 13px; line-height: 1.5; }
        .md-oli { list-style: decimal; }
        .md-li { list-style: disc; }
        .md-p { margin: 6px 0; }
        .md-link { color: #67e8f9; text-decoration: underline; text-underline-offset: 2px; }
        .md-link:hover { color: #22d3ee; }
        strong { color: rgba(255,255,255,0.95); font-weight: 600; }
        em { color: rgba(255,255,255,0.7); font-style: italic; }
      `}</style>
    </div>
  );
}

/* ── Copy Button ──────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute -bottom-8 right-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
      style={{ opacity: 1 }}
    >
      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {copied ? "Kopyalandı" : "Kopyala"}
    </button>
  );
}
