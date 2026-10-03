import { Link } from "react-router";
import { ArrowLeft, HelpCircle } from "lucide-react";
import HelpCenter from "@/components/HelpCenter";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * /help — the help center on its own page.
 *
 * It used to live inside the "Yardım & Hakkında" tab, which mixed reference
 * material with engine settings and turned that tab into a long scroll on a
 * phone. Settings now links here, and this page keeps its own back button so
 * the flow works in the packaged apps (no browser chrome to rely on).
 */
export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header
        className="sticky top-0 z-40 border-b border-border/70 bg-card/85 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-3">
          <Link
            to="/dashboard"
            className="flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Geri
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12">
              <HelpCircle className="h-4 w-4 text-primary" />
            </div>
            <h1 className="truncate text-sm font-bold tracking-tight">Yardım Merkezi</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* pb clears the floating island bar on this page too. */}
      <main className="px-4 pt-4 pb-28">
        <HelpCenter />
      </main>
    </div>
  );
}