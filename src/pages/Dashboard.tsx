import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import {
  Download,
  LogOut,
  ExternalLink,
  Server,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ArrowRight,
  Rocket,
  BookOpen,
  Globe,
  Terminal,
  Settings,
  FileCode,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useState } from "react";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const serverUrl = (import.meta as any).env.VITE_YTDLP_SERVER_URL || "";
  const isConfigured = !!serverUrl;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Authenticated workspace
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Welcome{user?.name ? `, ${user.name}` : ""}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer gap-2 self-start"
              onClick={() => navigate("/")}
            >
              <Download className="size-4" />
              New download
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer gap-2 self-start"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </header>

        {/* Server Status */}
        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Server className="size-5" />
            </div>
            <CardTitle>yt-dlp Server Status</CardTitle>
            <CardDescription>
              Your self-hosted video extraction engine that powers all downloads.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/30">
              {isConfigured ? (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/30">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">Server configured</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {serverUrl}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/30">
                    <XCircle className="h-4 w-4 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-amber-600 dark:text-amber-400">
                      Server not configured
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Deploy the yt-dlp server and set VITE_YTDLP_SERVER_URL
                    </p>
                  </div>
                </>
              )}
            </div>

            {!isConfigured && (
              <div className="p-4 rounded-lg bg-muted/50 border border-border/30">
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-primary" />
                  Quick deploy guide
                </p>
                <ol className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0 mt-0.5">1</span>
                    <span>Deploy the yt-dlp FastAPI server to <strong className="text-foreground">Railway</strong>, <strong className="text-foreground">Fly.io</strong>, or <strong className="text-foreground">Render</strong> using the Dockerfile in <code className="text-xs bg-muted px-1 rounded">yt-dlp-server/</code></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0 mt-0.5">2</span>
                    <span>Get your server URL (e.g. <code className="text-xs bg-muted px-1 rounded">https://vidfetch-ytdlp.up.railway.app</code>)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0 mt-0.5">3</span>
                    <span>Go to your project's <strong className="text-foreground">Keys/API Keys</strong> tab and add:</span>
                  </li>
                </ol>
                <div className="mt-3 flex items-center gap-2 p-2.5 rounded-md bg-background border border-border/40">
                  <span className="text-xs font-mono text-muted-foreground shrink-0">Key:</span>
                  <code className="text-xs font-mono text-foreground flex-1 break-all">VITE_YTDLP_SERVER_URL</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard("VITE_YTDLP_SERVER_URL")}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-2 p-2.5 rounded-md bg-background border border-border/40">
                  <span className="text-xs font-mono text-muted-foreground shrink-0">Value:</span>
                  <code className="text-xs font-mono text-muted-foreground flex-1">https://your-server-url.railway.app</code>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Links */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer" onClick={() => navigate("/")}>
            <CardContent className="p-6 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <Download className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-sm">Go to downloader</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Paste a URL and download from 1000+ sites
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer" onClick={() => window.open("https://github.com/yt-dlp/yt-dlp", "_blank")}>
            <CardContent className="p-6 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <BookOpen className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-sm">yt-dlp docs</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Learn about the engine powering your downloads
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Deployment Options */}
        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe className="size-5" />
            </div>
            <CardTitle>Deployment options</CardTitle>
            <CardDescription>
              Choose how to host your yt-dlp server
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                {
                  name: "Railway",
                  desc: "One-click deploy from GitHub. Free tier includes enough compute for personal use.",
                  icon: Rocket,
                  color: "text-purple-500",
                  url: "https://railway.app",
                },
                {
                  name: "Fly.io",
                  desc: "Global edge deployment with generous free allowance. Great for low-latency downloads.",
                  icon: Globe,
                  color: "text-blue-500",
                  url: "https://fly.io",
                },
                {
                  name: "Render",
                  desc: "Simple Docker deploys. Free web services with 512 MB RAM — plenty for yt-dlp.",
                  icon: Server,
                  color: "text-emerald-500",
                  url: "https://render.com",
                },
              ].map((option) => (
                <a
                  key={option.name}
                  href={option.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 rounded-lg border border-border/30 hover:border-border/60 hover:bg-muted/30 transition-all duration-200 group"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background border border-border/40 mb-3 ${option.color} group-hover:bg-primary/5 transition-colors`}>
                    <option.icon className="h-4.5 w-4.5" />
                  </div>
                  <p className="font-semibold text-sm">{option.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {option.desc}
                  </p>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileCode className="size-5" />
            </div>
            <CardTitle>About VidFetch</CardTitle>
            <CardDescription>
              Self-hosted video downloader powered by yt-dlp
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="space-y-2 text-sm text-muted-foreground flex-1">
                <p>
                  VidFetch is a beautiful frontend for{" "}
                  <a
                    href="https://github.com/yt-dlp/yt-dlp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    yt-dlp
                  </a>
                  , the most powerful video extraction engine available.
                </p>
                <p>
                  The yt-dlp server runs on your own infrastructure &mdash; no data
                  ever passes through third-party services. You control everything.
                </p>
                <p>
                  Supports over 1,000 sites including YouTube, TikTok, Twitter/X,
                  Instagram, Vimeo, Facebook, Twitch, and more.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
