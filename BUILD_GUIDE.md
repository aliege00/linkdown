# VidFetch — Çalıştırma ve Build Rehberi

## 📁 Proje Yapısı

```
vidfetch/
├── src/                    # React frontend (Vite + TypeScript)
│   ├── components/         # UI bileşenleri (DownloaderCard, WebDownloadCard, ClipboardNotification)
│   ├── components/ui/      # shadcn/ui bileşenleri
│   ├── components/tabs/    # Dashboard sekmeleri (DownloadsTab, SettingsTab, …)
│   ├── hooks/              # React hook'ları (useDownloadManager, useClipboardMonitor, …)
│   ├── lib/                # Yardımcı modüller (url, error-help, ytdlp-native, download-modes, …)
│   └── pages/              # Sayfalar (Landing, Dashboard, Chat, LegalPage, NotFound)
├── android/                # Capacitor Android projesi
│   └── app/src/main/java/com/vidfetch/downloader/
│       ├── DownloadBridge.kt   # Capacitor plugin (analiz/indirme/cookies köprüsü)
│       ├── DownloadWorker.kt   # WorkManager foreground indirme servisi
│       └── DownloadApp.kt      # yt-dlp + FFmpeg motor init
├── android-media/          # MediaStore galeri kayıt yardımcıları (Kotlin)
├── electron/               # Windows EXE kabuğu (main.cjs + preload.cjs)
├── scripts/                # İkon üretimi ve E2E test yardımcıları
└── .github/workflows/      # CI: build-apk.yml + release.yml
```

Not: Eski `src/convex/` backend'i ve `yt-dlp-server/` klasörü kaldırıldı — indirme
tamamen cihazda (APK/EXE içindeki gömülü yt-dlp motoru) çalışır, sunucu gerekmez.

---

## 🌐 Frontend (React + Vite) — Sıfırdan Çalıştırma

### Ön Koşullar

```bash
# Node.js 20+ ve npm
node --version
```

### Kurulum ve Geliştirme

```bash
npm install
npm run dev          # Tarayıcıda aç: http://localhost:5173
```

Tarayıcıda indirme motoru YOKTUR — analiz/indirme denemesi kullanıcıyı
uygulama indirme kartına yönlendirir. Tam deneyim için APK/EXE kurun.

### Doğrulama Komutları

```bash
npm run typecheck    # tsc -b --noEmit
npm test             # vitest
npm run build        # Vite production build (dist/)
node scripts/test-download-socket.cjs   # Electron WS E2E (yalnızca yerel test)
```

---

## 📱 Android APK Build

### Ön Koşullar

```bash
# Android SDK + JDK 17+ (Android Studio ile)
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
```

### Build Adımları

```bash
npm run build              # 1. Frontend build
npx cap sync android       # 2. Capacitor senkronizasyonu
cd android
./gradlew assembleRelease  # 3. Tek universal release APK
# Çıktı: android/app/build/outputs/apk/release/app-universal-release.apk
```

İmza ortam değişkenleri (`SIGNING_STORE_FILE`, `SIGNING_STORE_PASSWORD`,
`SIGNING_KEY_ALIAS`, `SIGNING_KEY_PASSWORD`) tanımlı değilse build Android SDK'nın
debug key'iyle imzalanır — **yalnızca geliştirme içindir**. Dağıtım imzalama kurulumu
(keytool komutları + GitHub Secrets) için README → "Release imzalama kurulumu".

---

## 🖥️ Windows EXE Build

```bash
npm run build
npx electron-builder --config electron-builder.yml --win nsis portable --publish never
# Çıktı: release/ klasöründe Setup + portable EXE'ler
```

---

## 🚀 CI / Release

- `main`e push → build-apk.yml APK artifact'ı üretir.
- `v*` tag push → build-apk.yml + release.yml çalışır, GitHub Release oluşturur:
  - `VidFetch-vX.Y.Z.apk` (tek universal, imzalı) + `VidFetch-latest.apk`
  - `VidFetch-Setup-vX.Y.Z.exe` + portable + `latest` kopyaları
  - Release notlarına APK SHA-256 özeti otomatik yazılır.

Sitedeki indirme linkleri `releases/latest/download/...` sabit adlarına işaret eder;
sürüm değişince site düzenlemesi gerekmez. İmzalama secret'ları ve tag akışı için
README'ye bakın.

---

## 🔧 Çevresel Değişkenler

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `VITE_YTDLP_SERVER_URL` | Hayır | Yalnızca kendi yt-dlp sunucunuzu barındırıyorsanız. Tanımlıysa web build analiz/indirmeyi bu sunucuya yapar; tanımlı değilse web'de motor yok kartı gösterilir. |

CI imzalama değişkenleri (`SIGNING_KEY`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`,
`SIGNING_KEY_PASSWORD`) GitHub Secrets'ta tutulur — repoya yazılmaz.

---

## 🐛 Sorun Giderme

### "İndirme motoru burada yok" kartı
- Tarayıcıda çalışıyorsunuz — normal. Android APK veya Windows EXE kurun.

### YouTube "Sign in to confirm you're not a bot"
- VPN'i kapatın
- Uygulamada cookies.txt içe aktarın (Gelişmiş → YouTube sorun giderme)
- Bu özellik bir hesap/oturum sistemi DEĞİLDİR: çerez dosyası yalnızca
  cihazda tutulur ve yt-dlp'ye `--cookies` olarak verilir.

### APK build başarısız
- `package-lock.json` repo'da var mı kontrol et
- `JAVA_HOME` ve `ANDROID_HOME` ayarlı mı kontrol et
- `npm run build` önce çalıştır (frontend build)

### Artifacts quota hatası (GitHub Actions)
- Eski artifact'ları sil: `gh api repos/OWNER/REPO/actions/artifacts --paginate --jq '.artifacts[].id' | xargs -I{} gh api -X DELETE repos/OWNER/REPO/actions/artifacts/{}`
