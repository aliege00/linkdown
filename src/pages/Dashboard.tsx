import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { Download, LogOut, ExternalLink, History, Clock, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  // Empty state for download history
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
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

        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <History className="size-5" />
            </div>
            <CardTitle>Download history</CardTitle>
            <CardDescription>
              Your downloaded videos will appear here once you start using the downloader.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted mb-4">
              <Download className="size-7 text-muted-foreground/50" />
            </div>
            <p className="font-medium text-foreground/80">No downloads yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-sm">
              Head over to the downloader to grab your first video. Your history will be saved here.
            </p>
            <Button onClick={() => navigate("/")} className="gap-2">
              <ArrowRight className="size-4" />
              Go to downloader
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/40 shadow-sm">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="size-5" />
            </div>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Stay tuned — recent downloads and activity will show up here in a future update.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
