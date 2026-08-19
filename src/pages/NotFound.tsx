import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowLeft, Download, SearchX } from "lucide-react";
import { useNavigate } from "react-router";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen flex flex-col bg-background text-foreground"
    >
      {/* Brand header */}
      <header className="border-b border-border/40">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Download className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-tight">VidFetch</span>
          </div>
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
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-center max-w-md"
        >
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <SearchX className="h-8 w-8" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary/70">
            404
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
            Page not found
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
            This page doesn't exist or was moved. The downloader is still one
            click away.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={() => navigate("/")}
              className="gap-2 w-full sm:w-auto"
            >
              <Download className="h-4 w-4" />
              Go to downloader
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate(-1)}
              className="gap-2 w-full sm:w-auto cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              Go back
            </Button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
