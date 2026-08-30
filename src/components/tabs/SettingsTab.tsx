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
import { FlatCard } from "@/components/FlatCard";
import { cn } from "@/lib/utils";
import { HELP_CONTENT, type HelpLang } from "@/lib/help-content";
import AiAssistant from "@/components/AiAssistant";

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
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#262930] bg-[#0d0f12] px-2.5 py-1.5 text-[11px] font-medium text-[#8e8e93] transition-colors hover:border-[#6cb4ee]/40 hover:text-[#e8e8e8]"
    >
      {copied ? (
        <Check className="h-3 w-3 text-[#34c759]" />
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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* ── App Info ── */}
      <FlatCard interactive className="space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[#6cb4ee]">
          <Sparkles className="size-7 text-[#0d0f12]" />
        </div>
        <h2 className="text-xl font-bold text-[#e8e8e8]">VidFetch</h2>
        <p className="text-xs text-[#8e8e93]">
          v2.3 · On-device video downloader
        </p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { label: "Motor", value: "yt-dlp" },
            { label: "Platform", value: "1000+" },
            { label: "Ücret", value: "Ücretsiz" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[#262930] bg-[#0d0f12] p-3"
            >
              <p className="text-lg font-bold text-[#6cb4ee]">{s.value}</p>
              <p className="text-[10px] text-[#8e8e93]">{s.label}</p>
            </div>
          ))}
        </div>
      </FlatCard>

      {/* ── Description ── */}
      <FlatCard interactive>
        <p className="text-center text-xs leading-relaxed text-[#8e8e93]">
          VidFetch,{" "}
          <a
            href="https://github.com/yt-dlp/yt-dlp"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#6cb4ee] hover:underline"
          >
            yt-dlp
          </a>{" "}
          motorunu doğrudan cihazınızda çalıştırır. Sunucu, bulut veya hesap
          yoktur. 1000+ site desteklenir — sınırsız, anahtarsız indirme.
        </p>
      </FlatCard>

      {/* ── Help Tabs ── */}
      <FlatCard interactive>
        {/* Language */}
        <div className="mb-4 flex justify-center">
          <div className="flex rounded-lg border border-[#262930] bg-[#0d0f12] p-0.5">
            {(["tr", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => {
                  setHelpLang(lang);
                  localStorage.setItem("vidfetch.helpLang", lang);
                }}
                className={cn(
                  "rounded-md px-4 py-2 text-xs font-semibold transition-colors",
                  helpLang === lang
                    ? "bg-[#6cb4ee] text-[#0d0f12]"
                    : "text-[#8e8e93] hover:text-[#e8e8e8]",
                )}
              >
                {lang === "tr" ? "Türkçe" : "English"}
              </button>
            ))}
          </div>
        </div>

        <Tabs defaultValue="bot">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1">
            <TabsTrigger
              value="ai"
              className="gap-1 whitespace-normal px-1 py-2.5 text-center text-[11px] leading-tight"
            >
              <Bot className="h-3.5 w-3.5 shrink-0" />
              AI Asistan
            </TabsTrigger>
            <TabsTrigger
              value="bot"
              className="gap-1 whitespace-normal px-1 py-2.5 text-center text-[11px] leading-tight"
            >
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              {help.tabs.bot}
            </TabsTrigger>
            <TabsTrigger
              value="errors"
              className="gap-1 whitespace-normal px-1 py-2.5 text-center text-[11px] leading-tight"
            >
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              {help.tabs.errors}
            </TabsTrigger>
            <TabsTrigger
              value="tips"
              className="gap-1 whitespace-normal px-1 py-2.5 text-center text-[11px] leading-tight"
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
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-[#6cb4ee]/30 bg-[#6cb4ee]/10 text-sm font-bold text-[#6cb4ee] transition-colors hover:bg-[#6cb4ee]/20 active:scale-[0.98]"
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
                  <Globe className="h-4 w-4 text-[#6cb4ee]" />
                  {help.bot.introTitle}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#8e8e93]">
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
                      className="rounded-xl border border-[#262930] bg-[#0d0f12] p-3"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6cb4ee]/10 text-[11px] font-bold text-[#6cb4ee]">
                          {i + 1}
                        </span>
                        <p className="text-sm font-medium">{fix.title}</p>
                      </div>
                      <p className="text-xs leading-relaxed text-[#8e8e93]">
                        {fix.body}
                      </p>
                      {"command" in fix && fix.command && (
                        <div className="mt-2 flex items-start gap-2">
                          <code className="min-w-0 flex-1 break-all rounded-lg border border-[#262930] bg-[#0d0f12] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[#8e8e93]">
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
                  className="rounded-xl border border-[#262930] bg-[#0d0f12] p-3"
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-[#8e8e93]">{item.what}</p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-[#34c759]">
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
                  className="flex items-start gap-3 rounded-xl border border-[#262930] bg-[#0d0f12] p-3"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#ff9f0a]/10">
                    <Lightbulb className="h-4 w-4 text-[#ff9f0a]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#8e8e93]">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </FlatCard>

      {/* ── Sign Out ── */}
      <div className="flex justify-center pb-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-xs text-[#8e8e93]"
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
