#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# VidFetch — GitHub Repo Setup Guide
# ─────────────────────────────────────────────────────────────
# Run this script to see step-by-step instructions for
# creating your GitHub repo and triggering APK/EXE builds.
# ─────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║        VidFetch — GitHub Repo Setup Guide           ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Step 1 ──────────────────────────────────────────────────
echo -e "${BOLD}${GREEN}Step 1: Create a GitHub repository${NC}"
echo ""
echo "  1. Go to https://github.com/new"
echo "  2. Enter a repository name (e.g., \"vidfetch\")"
echo "  3. Keep it Public"
echo "  4. Don't initialize with README, .gitignore, or license"
echo "  5. Click \"Create repository\""
echo ""

# ─── Step 2 ──────────────────────────────────────────────────
echo -e "${BOLD${GREEN}Step 2: Push the project to GitHub${NC}"
echo ""
echo "  Run these commands in your local terminal (where this project is):"
echo ""
echo -e "  ${CYAN}git init${NC}"
echo -e "  ${CYAN}git add .${NC}"
echo -e "  ${CYAN}git commit -m \"Initial commit — VidFetch video downloader\"${NC}"
echo -e "  ${CYAN}git branch -M main${NC}"
echo -e "  ${CYAN}git remote add origin https://github.com/YOUR_USERNAME/vidfetch.git${NC}"
echo -e "  ${CYAN}git push -u origin main${NC}"
echo ""
echo -e "  ${YELLOW}(Replace YOUR_USERNAME with your actual GitHub username)${NC}"
echo ""

# ─── Step 3 ──────────────────────────────────────────────────
echo -e "${BOLD}${GREEN}Step 3: Watch the magic happen${NC}"
echo ""
echo "  Once you push, go to your repo on GitHub and click the"
echo "  \"Actions\" tab. You'll see two workflows running:"
echo ""
echo -e "  ${BOLD}1. Build Debug APK${NC}"
echo "     - Builds a debug APK of VidFetch for Android"
echo "     - Download from the workflow run's \"Artifacts\" section"
echo ""
echo -e "  ${BOLD}2. Build Portable EXE (PWABuilder)${NC}"
echo "     - Builds a Windows portable EXE using PWABuilder"
echo "     - Download from the workflow run's \"Artifacts\" section"
echo ""

# ─── Step 4 ──────────────────────────────────────────────────
echo -e "${BOLD}${GREEN}Step 4: Create a Release (optional)${NC}"
echo ""
echo "  To create a proper release with auto-generated APK/EXE:"
echo ""
echo -e "  ${CYAN}git tag v1.0.0${NC}"
echo -e "  ${CYAN}git push origin v1.0.0${NC}"
echo ""
echo "  This triggers both workflows AND uploads the artifacts"
echo "  to a GitHub Release page automatically."
echo ""

# ─── Step 5 ──────────────────────────────────────────────────
echo -e "${BOLD}${GREEN}Step 5: Set up environment secrets${NC}"
echo ""
echo "  In your GitHub repo: Settings → Secrets and variables → Actions"
echo "  Add these secrets (optional — the build works without them):"
echo ""
echo -e "  ${BOLD}VITE_CONVEX_URL${NC}       — Your deployed Convex backend URL"
echo -e "  ${BOLD}VITE_YTDLP_SERVER_URL${NC} — Your yt-dlp server URL"
echo ""
echo "  If not set, the APK/EXE will work but won't connect to backends"
echo "  until the user configures them in the app settings."
echo ""

# ─── Manual Build ────────────────────────────────────────────
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║        Manual Build (without GitHub Actions)        ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  If you want to build the APK on your own computer:"
echo ""
echo -e "  ${YELLOW}Prerequisites:${NC} Node.js 20+, Java 17+, Android Studio"
echo ""
echo -e "  ${CYAN}npm run build${NC}"
echo -e "  ${CYAN}npx cap sync android${NC}"
echo -e "  ${CYAN}cd android && ./gradlew assembleDebug${NC}"
echo ""
echo -e "  ${YELLOW}Output:${NC} android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo -e "  For the EXE on your Windows machine:"
echo -e "  ${CYAN}npm install -g @pwabuilder/pwabuilder-cli${NC}"
echo -e "  ${CYAN}npx pwabuilder package --platform windows --file dist --out output${NC}"
echo ""

# ─── PWABuilder Online (alternative) ────────────────────────
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║        PWABuilder Online (no setup needed)          ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  You can also get the EXE without any build tools:"
echo ""
echo "  1. Deploy the web app (or use a local tunnel like ngrok)"
echo "  2. Go to https://pwabuilder.com"
echo "  3. Enter your PWA URL"
echo "  4. Click \"Package\" → \"Windows\""
echo "  5. Download the generated .msix/.exe package"
echo ""
echo "  This works because VidFetch is already a fully featured PWA"
echo "  with manifest, service worker, and offline support."
echo ""
