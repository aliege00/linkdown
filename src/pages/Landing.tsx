import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ChevronDown,
  Crown,
  Download,
  FileVideo,
  Film,
  Globe,
  Image,
  Monitor,
  Music,
  Play,
  Shield,
  Smartphone,
  Sparkles,
  Video,
  Youtube,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import DownloaderCard, { type PageState } from "@/components/DownloaderCard";

// ─── Helpers ──────────────────────────────────────────────────────────

// Build fingerprint injected by index.html (fix10, etc.) so a screenshot of
// the app or its footer tells us exactly which APK/EXE build is installed.
const BUILD_TAG =
  typeof window !== "undefined"
    ? window.__VIDFETCH_BUILD__ ?? null
    : null;

// ─── Component ────────────────────────────────────────────────────────

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  // Mirrors the downloader card's page state so the hero scroll hint hides
  // while a video is being analyzed / downloaded. The heavy downloader state
  // itself lives inside <DownloaderCard>, so progress ticks and typing never
  // re-render the marketing sections below.
  const [heroState, setHeroState] = useState<PageState>("idle");
  const [footerOpen, setFooterOpen] = useState<number | null>(null);

  // ─── FAQ data ──────────────────────────────────────────────────────
  const faqs = [
    {
      q: "How does VidFetch work?",
      a: "Paste any video URL from YouTube, TikTok, Twitter/X, Instagram, Vimeo, and thousands of other sites. The built-in yt-dlp engine extracts the video and saves it straight to your device. No sign-ups required.",
    },
    {
      q: "What sites are supported?",
      a: "Over 1,000 sites including YouTube, TikTok, Twitter/X, Instagram, Vimeo, Facebook, Reddit, Twitch, Dailymotion, and many more. If you can watch it online, we can probably download it.",
    },
    {
      q: "Do I need a server or an API key?",
      a: "No. There is no server — the phone or the desktop app IS the engine. Everything runs on your device, completely free and unlimited, with no API keys and no setup.",
    },
    {
      q: "Is this service free?",
      a: "Yes — 100% free and unlimited. No accounts, no API keys, no rate limits, no monthly caps. Your device does all the work.",
    },
    {
      q: "Are there any file size limits?",
      a: "None at all. Since downloads run on your device, the only limit is your own storage space.",
    },
    {
      q: "Is my privacy protected?",
      a: "Yes. Everything happens on your device — videos are downloaded directly to your phone or PC. Nothing is ever uploaded to a server, and we don't log or track anything.",
    },
  ];

  // ─── Page render ───────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col overflow-x-hidden"
    >
      {/* ═══ Navigation ═══ */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Download className="h-4.5 w-4.5" />
            </div>
            <span className="text-base font-semibold tracking-tight">VidFetch</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
            <button
              onClick={() => inputRef.current?.focus()}
              className="hover:text-foreground transition-colors cursor-pointer"
            >
              Download
            </button>
            <button
              onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="hover:text-foreground transition-colors cursor-pointer"
            >
              How it works
            </button>
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate("/dashboard")}>
                Dashboard
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => navigate("/auth")}>
                Sign in
              </Button>
            )}
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              className="sm:hidden"
              onClick={() => navigate(isAuthenticated ? "/dashboard" : "/auth")}
            >
              {isAuthenticated ? "Dashboard" : "Sign in"}
            </Button>
          </div>
        </div>
      </header>

      {/* ═══ Hero ═══ */}
      <motion.section
        className="relative min-h-[90vh] flex flex-col items-center justify-center px-6 pt-24 pb-16"
      >
        {/* Subtle background grid */}
        <div className="absolute inset-0 bg-subtle-grid pointer-events-none" />

        {/* Decorative glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />

        <div className="relative z-10 mx-auto max-w-4xl text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6 flex justify-center"
          >
            <Badge
              variant="outline"
              className="gap-1.5 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              <Sparkles className="h-3 w-3" />
              Powered by yt-dlp
            </Badge>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]"
          >
            Download from{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
              1000+ sites
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            YouTube, TikTok, Twitter/X, Instagram &mdash; paste any video link,
            pick your quality, and download. The engine runs right on your device.
          </motion.p>

          {/* Downloader Card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-10 mx-auto max-w-2xl"
          >
            <DownloaderCard
              inputRef={inputRef}
              resultsRef={resultsRef}
              onStateChange={setHeroState}
            />
          </motion.div>
        </div>

        {/* Scroll indicator */}
        {heroState === "idle" && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, 6, 0] }}
            transition={{ delay: 1, y: { repeat: Infinity, duration: 2 } }}
            onClick={() =>
              featuresRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="h-6 w-6" />
          </motion.button>
        )}
      </motion.section>

      {/* ═══ Results / Video Info (scroll target) ═══ */}
      <div ref={resultsRef} />

      {/* ═══ How it Works ═══ */}
      <section ref={featuresRef} className="scroll-mt-20 relative px-6 py-24 border-t border-border/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              How it works
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Your device is the engine
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              No servers to deploy. No API keys to manage. It just works.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Smartphone,
                title: "Engine on your device",
                description:
                  "The yt-dlp engine is built into the Android and Windows apps. No server, no API key, no setup.",
                step: "01",
              },
              {
                icon: Youtube,
                title: "Paste & analyze",
                description:
                  "Paste any video URL. VidFetch's on-device engine extracts the metadata and available formats instantly.",
                step: "02",
              },
              {
                icon: Download,
                title: "Choose & download",
                description:
                  "Pick your preferred quality from 4K to audio-only. The video saves directly to your device.",
                step: "03",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="border-border/40 shadow-sm hover:shadow-md hover:border-border/70 transition-all duration-300 h-full group">
                  <CardContent className="p-8 flex flex-col items-start gap-4">
                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground/40 uppercase">
                      Step {item.step}
                    </span>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                      <item.icon className="h-5.5 w-5.5" />
                    </div>
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Supported Sites ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30 bg-muted/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              Supported sites
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Over 1,000 platforms
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Powered by yt-dlp &mdash; the most comprehensive video extraction engine.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Youtube, label: "YouTube", desc: "Videos, Shorts, playlists", color: "text-red-500" },
              { icon: Video, label: "TikTok", desc: "Videos, livestreams", color: "text-pink-400" },
              { icon: Monitor, label: "Twitter/X", desc: "Tweets with media", color: "text-sky-400" },
              { icon: Film, label: "Instagram", desc: "Reels, posts, stories", color: "text-purple-400" },
              { icon: Globe, label: "Vimeo", desc: "HD videos", color: "text-blue-400" },
              { icon: Play, label: "Facebook", desc: "Public videos", color: "text-blue-600" },
              { icon: FileVideo, label: "Twitch", desc: "Clips, VODs", color: "text-violet-500" },
              { icon: Music, label: "SoundCloud", desc: "Tracks, playlists", color: "text-orange-400" },
              { icon: Image, label: "Reddit", desc: "Videos in posts", color: "text-orange-500" },
              { icon: Globe, label: "Dailymotion", desc: "User uploads", color: "text-blue-500" },
              { icon: Video, label: "VK", desc: "Social videos", color: "text-blue-400" },
              { icon: Zap, label: "1000+ more", desc: "Any site yt-dlp supports", color: "text-primary" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="border-border/30 shadow-none hover:shadow-sm hover:border-border/60 transition-all duration-300 h-full group">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background border border-border/40 transition-colors group-hover:bg-primary/5",
                        item.color,
                      )}
                    >
                      <item.icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              Features
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Why you'll love it
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: "Your data stays on your device",
                desc: "Downloads run locally on your phone or PC. Zero third-party requests, zero logs, zero tracking.",
              },
              {
                icon: Zap,
                title: "Unlimited downloads",
                desc: "No rate limits, no API keys, no monthly caps. Download as many videos as you want.",
              },
              {
                icon: Crown,
                title: "Best quality possible",
                desc: "yt-dlp extracts the highest quality available — up to 4K, 60fps, with proper audio.",
              },
              {
                icon: Globe,
                title: "1000+ sites supported",
                desc: "YouTube, TikTok, Twitter, Instagram, Vimeo, Facebook, Twitch, and thousands more.",
              },
              {
                icon: Sparkles,
                title: "Format selection UI",
                desc: "Pick exactly the resolution and format you want from a beautiful, intuitive interface.",
              },
              {
                icon: Monitor,
                title: "Runs on your device",
                desc: "The engine ships inside the app itself — phone or desktop. Nothing to host, nothing to deploy.",
              },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="border-border/30 shadow-none hover:shadow-sm hover:border-border/60 transition-all duration-300 h-full group">
                  <CardContent className="p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4 group-hover:bg-primary/15 transition-colors">
                      <feature.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold mb-1.5">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.desc}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30 bg-muted/30">
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-12"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              FAQ
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Frequently asked questions
            </h2>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.05 }}
              >
                <Card
                  className={cn(
                    "border-border/30 shadow-none cursor-pointer transition-all duration-200",
                    footerOpen === i
                      ? "border-primary/30 shadow-sm"
                      : "hover:border-border/60",
                  )}
                  onClick={() =>
                    setFooterOpen(footerOpen === i ? null : i)
                  }
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="font-medium text-sm sm:text-base">
                        {faq.q}
                      </h3>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                          footerOpen === i && "rotate-180",
                        )}
                      />
                    </div>
                    <AnimatePresence>
                      {footerOpen === i && (
                        <motion.p
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="mt-3 text-sm text-muted-foreground leading-relaxed overflow-hidden"
                        >
                          {faq.a}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-2xl text-center relative z-10"
        >
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Ready to download?
          </h2>
          <p className="mt-4 text-muted-foreground">
            No server. No API key. No limits. Paste a link and download from
            1000+ sites, right on your device.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={() => inputRef.current?.focus()}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Start downloading
            </Button>
            {!isAuthenticated && (
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/auth")}
                className="gap-2"
              >
                <ArrowRight className="h-4 w-4" />
                Create account
              </Button>
            )}
          </div>
        </motion.div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-border/30 bg-background">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Download className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">VidFetch</span>
            </div>
            <p className="text-xs text-muted-foreground">
              On-device video downloader. Powered by yt-dlp.
              {BUILD_TAG && (
                <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">
                  build {BUILD_TAG}
                </span>
              )}
            </p>
          </div>
        </div>
      </footer>
    </motion.div>
  );
}
