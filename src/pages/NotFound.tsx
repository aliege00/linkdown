import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Home, SearchX, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen flex flex-col bg-background text-foreground relative overflow-hidden"
    >
      {/* Background decoration */}
      <div className="absolute inset-0 bg-subtle-grid pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />

      {/* Brand header */}
      <header className="relative z-10 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Download className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-tight">
              VidFetch
            </span>
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-2 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="text-center max-w-lg"
        >
          {/* Animated icon */}
          <motion.div
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary"
          >
            <SearchX className="h-10 w-10" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-sm font-semibold uppercase tracking-widest text-primary/70"
          >
            404
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight"
          >
            Page not found
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed max-w-md mx-auto"
          >
            This page doesn't exist or was moved. But the downloader is still
            one click away — paste any video link and download.
          </motion.p>

          {/* Action buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Button
              size="lg"
              onClick={() => navigate("/")}
              className="gap-2 w-full sm:w-auto shadow-md shadow-primary/20"
            >
              <Download className="h-4 w-4" />
              Go to downloader
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/")}
              className="gap-2 w-full sm:w-auto cursor-pointer"
            >
              <Home className="h-4 w-4" />
              Back to home
            </Button>
          </motion.div>

          {/* Helpful tips */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-12"
          >
            <Card className="border-border/30 shadow-none bg-muted/20 inline-block">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">Tip: No server needed</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    VidFetch runs entirely on your device — paste a link and download.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
