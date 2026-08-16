import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Download,
  LogOut,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  Globe,
  Shield,
  Zap,
  Smartphone,
  Monitor,
  Infinity as InfinityIcon,
  FileVideo,
} from "lucide-react";
import { useNavigate } from "react-router";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-background px-4 sm:px-6 py-6 sm:py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:gap-8">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs sm:text-sm font-medium text-muted-foreground">
              Authenticated workspace
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight">
              Welcome{user?.name ? `, ${user.name}` : ""}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer gap-2 self-start active:scale-[0.97] min-h-[40px]"
              onClick={() => navigate("/")}
            >
              <Download className="size-4" />
              New download
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer gap-2 self-start active:scale-[0.97] min-h-[40px]"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </header>

        {/* Engine Status — on-device, no server needed */}
        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="size-5" />
            </div>
            <CardTitle>Download engine</CardTitle>
            <CardDescription>
              Everything runs right on this device — no servers, no API keys, no limits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 sm:p-4 rounded-lg border border-emerald-200/60 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 shrink-0">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-emerald-700 dark:text-emerald-300">
                  Built-in engine — always ready
                </p>
                <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70 mt-0.5">
                  The yt-dlp engine is embedded in this app. Paste a link, pick a quality, download.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              {[
                {
                  icon: Zap,
                  title: "No server needed",
                  desc: "The phone or desktop app is the engine. Nothing to deploy.",
                },
                {
                  icon: InfinityIcon,
                  title: "Unlimited downloads",
                  desc: "No rate limits, no API keys, no monthly caps. Ever.",
                },
                {
                  icon: Shield,
                  title: "Private by design",
                  desc: "Videos are processed and saved on your device — nothing leaves it.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="p-4 rounded-lg border border-border/30 bg-muted/30"
                >
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary mb-2.5">
                    <item.icon className="size-4" />
                  </div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer" onClick={() => navigate("/")}>
            <CardContent className="p-6 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <FileVideo className="size-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Go to downloader</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Paste a URL and download from 1000+ sites
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1" />
            </CardContent>
          </Card>

          <Card className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer" onClick={() => window.open("https://github.com/yt-dlp/yt-dlp", "_blank")}>
            <CardContent className="p-6 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <BookOpen className="size-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">yt-dlp docs</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Learn about the engine powering your downloads
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1" />
            </CardContent>
          </Card>
        </div>

        {/* Runs everywhere */}
        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe className="size-5" />
            </div>
            <CardTitle>Take the engine anywhere</CardTitle>
            <CardDescription>
              One app, fully self-contained on every device you use
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  name: "Android (APK)",
                  desc: "The full yt-dlp engine runs on your phone. Downloads continue in the background with progress notifications, and videos land in your chosen folder.",
                  icon: Smartphone,
                },
                {
                  name: "Windows (EXE)",
                  desc: "A portable desktop app with the engine built in. No install, no setup — just paste and download.",
                  icon: Monitor,
                },
              ].map((option) => (
                <div
                  key={option.name}
                  className="p-4 rounded-lg border border-border/30 hover:border-border/60 hover:bg-muted/30 transition-all duration-200 group"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-background border border-border/40 mb-3 text-primary group-hover:bg-primary/5 transition-colors">
                    <option.icon className="size-4.5" />
                  </div>
                  <p className="font-semibold text-sm">{option.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {option.desc}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="size-5" />
            </div>
            <CardTitle>About VidFetch</CardTitle>
            <CardDescription>
              A video downloader that lives entirely on your device
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="space-y-2 text-sm text-muted-foreground flex-1">
                <p>
                  VidFetch wraps{" "}
                  <a
                    href="https://github.com/yt-dlp/yt-dlp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    yt-dlp
                  </a>
                  , the most powerful video extraction engine available, directly into your
                  phone and desktop apps.
                </p>
                <p>
                  There is no server, no cloud, and no account to manage &mdash; the device
                  you're holding is the engine. Your downloads never pass through
                  third-party services.
                </p>
                <p>
                  Supports over 1,000 sites including YouTube, TikTok, Twitter/X,
                  Instagram, Vimeo, Facebook, Twitch, and more &mdash; with unlimited,
                  key-free downloads.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
