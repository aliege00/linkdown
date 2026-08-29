import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  Sparkles,
  Sparkle,
  Globe,
  ShieldAlert,
  Lightbulb,
  HelpCircle,
  Bot,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GlassCard } from "@/components/GlassCard";
import { cn } from "@/lib/utils";
import { HELP_CONTENT, type HelpLang } from "@/lib/help-content";
import AiAssistant from "@/components/AiAssistant";

/* ─── Copy Command (inline helper) ────────────────────────────────────────── */
function CopyCommand({
  command,
  label,
  copiedLabel,
}: {
  command: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-background/50 px-2 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}

export default function SettingsTab() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [helpLang, setHelpLang] = useState<HelpLang>(() => {
    try {
      const s = localStorage.getItem("vidfetch.helpLang");
      return s === "en" || s === "tr" ? s : "tr";
    } catch {
      return "tr";
    }
  });

  const help = HELP_CONTENT[helpLang];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* ── App Info ── */}
      <GlassCard interactive className="space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-xl shadow-cyan-500/25">
          <Sparkles className="size-7" />
        </div>
        <h2 className="bg-gradient-to-r from-cyan-500 to-violet-500 bg-clip-text text-xl font-bold text-transparent">
          VidFetch
        </h2>
        <p className="text-xs text-muted-foreground/70">
          v2.0 · On-device video downloader
        </p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { label: "Motor", value: "yt-dlp" },
            { label: "Platform", value: "1000+" },
            { label: "Ücret", value: "Ücretsiz" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border/20 bg-white/5 p-3 dark:bg-white/[0.02]"
            >
              <p className="text-lg font-bold text-primary">{s.value}</p>
              <p className="text-[10px] text-muted-foreground/60">{s.label}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ── Description ── */}
      <GlassCard interactive>
        <p className="text-center text-xs leading-relaxed text-muted-foreground/70">
          VidFetch,{" "}
          <a
            href="https://github.com/yt-dlp/yt-dlp"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            yt-dlp
          </a>{" "}
          motorunu doğrudan cihazınızda çalıştırır. Sunucu, bulut veya hesap
          yoktur. 1000+ site desteklenir — sınırsız, anahtarsız indirme.
        </p>
      </GlassCard>

      {/* ── Help Tabs ── */}
      <GlassCard interactive>
        {/* Language switcher */}
        <div className="mb-4 flex justify-center">
          <div className="flex items-center gap-0.5 rounded-full border border-border/30 bg-white/5 p-0.5 dark:bg-white/[0.02]">
            {(["tr", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => {
                  setHelpLang(lang);
                  localStorage.setItem("vidfetch.helpLang", lang);
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                  helpLang === lang
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {lang === "tr" ? "Türkçe" : "English"}
              </button>
            ))}
          </div>
        </div>

        <Tabs defaultValue="bot">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-0.5 p-1">
            <TabsTrigger
              value="ai"
              className="gap-1 whitespace-normal px-1 py-2 text-center text-[11px] leading-tight"
            >
              <Bot className="h-3.5 w-3.5 shrink-0" />
              AI Asistan
            </TabsTrigger>
            <TabsTrigger
              value="bot"
              className="gap-1 whitespace-normal px-1 py-2 text-center text-[11px] leading-tight"
            >
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              {help.tabs.bot}
            </TabsTrigger>
            <TabsTrigger
              value="errors"
              className="gap-1 whitespace-normal px-1 py-2 text-center text-[11px] leading-tight"
            >
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              {help.tabs.errors}
            </TabsTrigger>
            <TabsTrigger
              value="tips"
              className="gap-1 whitespace-normal px-1 py-2 text-center text-[11px] leading-tight"
            >
              <Lightbulb className="h-3.5 w-3.5 shrink-0" />
              {help.tabs.tips}
            </TabsTrigger>
          </TabsList>

          {/* AI */}
          <TabsContent value="ai" className="mt-4 space-y-4">
            <AiAssistant lang={helpLang} />
            <button
              type="button"
              onClick={() => navigate("/chat")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-400 transition-colors hover:bg-cyan-500/20"
            >
              <Sparkle className="size-4" />
              {helpLang === "tr"
                ? "Tam Ekran AI Sohbet"
                : "Full Screen AI Chat"}
            </button>
          </TabsContent>

          {/* Bot */}
          <TabsContent value="bot" className="mt-4">
            <div className="space-y-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  {help.bot.introTitle}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {help.bot.intro}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">
                  {help.bot.fixesTitle}
                </p>
                <div className="space-y-2">
                  {help.bot.fixes.map((fix, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border/30 bg-white/3 p-3 dark:bg-white/[0.01]"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                          {i + 1}
                        </span>
                        <p className="text-sm font-medium">{fix.title}</p>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {fix.body}
                      </p>
                      {"command" in fix && fix.command && (
                        <div className="mt-2 flex items-start gap-2">
                          <code className="min-w-0 flex-1 break-all rounded-lg border border-border/30 bg-white/3 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground dark:bg-white/[0.01]">
                            {fix.command}
                          </code>
                          <CopyCommand
                            command={fix.command}
                            label={help.copyLabel}
                            copiedLabel={help.copiedLabel}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Errors */}
          <TabsContent value="errors" className="mt-4">
            <p className="mb-1 text-sm font-semibold">{help.errors.title}</p>
            <div className="space-y-2">
              {help.errors.items.map((item, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/30 bg-white/3 p-3 dark:bg-white/[0.01]"
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.what}
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {item.fix}
                  </p>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Tips */}
          <TabsContent value="tips" className="mt-4">
            <p className="mb-1 text-sm font-semibold">{help.tips.title}</p>
            <div className="space-y-2">
              {help.tips.items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-border/30 bg-white/3 p-3 dark:bg-white/[0.01]"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                    <Lightbulb className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </GlassCard>

      {/* ── Sign Out ── */}
      <div className="flex justify-center pb-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-xs text-muted-foreground/60"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          Çıkış Yap
        </Button>
      </div>
    </div>
  );
}
