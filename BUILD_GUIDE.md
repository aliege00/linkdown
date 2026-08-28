# VidFetch — Çalıştırma ve Build Rehberi

## 📁 Proje Yapısı

```
vidfetch/
├── src/                    # React frontend (Vite + TypeScript)
│   ├── components/         # UI bileşenleri (DownloaderCard, ClipboardNotification)
│   ├── hooks/              # React hook'ları (useDownloadManager, useClipboardMonitor)
│   ├── lib/                # Yardımcı modüller (url, error-help, gallery-save)
│   ├── pages/              # Sayfalar (Landing, Dashboard, Auth, NotFound)
│   └── convex/             # Convex backend (auth, schema)
├── yt-dlp-server/          # Python backend (FastAPI + yt-dlp)
│   ├── main.py             # Ana sunucu
│   ├── chunked_downloader.py  # Çok kanallı indirme motoru
│   ├── resume_download.py  # Duraklat/devam et yöneticisi
│   ├── auto_update.py      # Otomatik güncelleme
│   └── requirements.txt    # Python bağımlılıkları
├── android-media/          # Android native kodlar
│   ├── MediaStoreHelper.kt # Galeriye kaydetme (MediaStore API)
│   ├── MediaStorePlugin.kt # Capacitor plugin bridge
│   └── AndroidManifest-snippet.xml  # İzin bildirimleri
└── android/                # Capacitor Android projesi (build sırasında oluşur)
```

---

## 🖥️ Backend (yt-dlp-server) — Sıfırdan Çalıştırma

### Ön Koşullar

```bash
# Python 3.10+ kurulumu (Ubuntu/Debian)
sudo apt update && sudo apt install -y python3 python3-pip python3-venv ffmpeg

# macOS
brew install python@3.12 ffmpeg
```

### Kurulum

```bash
cd yt-dlp-server

# Sanal ortam oluştur
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Bağımlılıkları kur
pip install -r requirements.txt

# Sunucuyu çalıştır
python main.py
# veya
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### Test

```bash
# Sağlık kontrolü
curl http://localhost:8080/api/health

# Video bilgisi çekme
curl "http://localhost:8080/api/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Chunked probe
curl "http://localhost:8080/api/chunked/probe?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Chunked indirme başlat
curl "http://localhost:8080/api/chunked/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&output_name=test.mp4&threads=4"
```

### Docker ile Çalıştırma

```bash
cd yt-dlp-server
docker build -t vidfetch-ytdlp .
docker run -p 8080:8080 vidfetch-ytdlp
```

---

## 🌐 Frontend (React + Vite) — Sıfırdan Çalıştırma

### Ön Koşullar

```bash
# Node.js 20+ ve npm/bun kurulumu
# macOS
brew install node@20

# Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# npm yerine bun (hızlı paket yöneticisi)
npm install -g bun
```

### Kurulum ve Geliştirme

```bash
# Proje kök dizininde
bun install          # veya npm install

# Geliştirme sunucusu (hot reload)
bun dev              # veya npm run dev

# Tarayıcıda aç: http://localhost:5173
```

### Typecheck

```bash
bun tsc -b --noEmit
```

### Lint

```bash
bun lint
```

### Production Build

```bash
bun run build        # Vite production build
bun run preview      # Build'i önizle
```

---

## 📱 Android APK Build

### Ön Koşullar

```bash
# Android SDK (SDK Manager veya Android Studio ile)
# JAVA_HOME ayarla (JDK 17+)
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk

# Capacitor CLI kurulumu
npm install -g @capacitor/cli
```

### Build Adımları

```bash
# 1. Frontend'i build et
bun run build

# 2. Capacitor'ı senkronize et
npx cap sync android

# 3. Android projesini aç (isteğe bağlı — Android Studio'da düzenlemek için)
npx cap open android

# 4. APK build et (komut satırından)
cd android
./gradlew assembleDebug

# APK çıktısı:
# android/app/build/outputs/apk/debug/app-debug.apk

# Release APK (imzalı)
./gradlew assembleRelease
# android/app/build/outputs/apk/release/app-release.apk
```

### CI/CD (GitHub Actions)

Otomatik APK build için `.github/workflows/build-apk.yml` dosyası mevcut.
Push veya PR'da otomatik build çalışır.

```bash
# Manuel tetikleme
gh workflow run build-apk.yml
```

---

## 🖥️ Windows EXE Build

### Ön Koşullar

```bash
# Electron builder kurulumu
npm install -g electron-builder
```

### Build

```bash
# Frontend'i build et
bun run build

# EXE'yi paketle
npx electron-builder --config electron-builder.yml

# Çıktı: dist_electron/ klasöründe .exe dosyası
```

---

## 🔧 Çevresel Değişkenler

### Frontend (.env)

| Değişken | Açıklama |
|---|---|
| `VITE_CONVEX_URL` | Convex deployment URL (opsiyonel) |
| `VITE_YTDLP_SERVER_URL` | yt-dlp sunucu URL'si (ör: `http://localhost:8080`) |

### Backend (Python ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `HOST` | `0.0.0.0` | Sunucu bind adresi |
| `PORT` | `8080` | Sunucu portu |
| `DOWNLOAD_DIR` | `/tmp/vidfetch-downloads` | Geçici indirme klasörü |
| `CLEANUP_AGE_SECONDS` | `1800` | Otomatik temizleme süresi (sn) |
| `CHUNKED_DOWNLOAD_THREADS` | `8` | Paralel indirme thread sayısı |
| `CHUNKED_DOWNLOAD_CHUNK_SIZE` | `4194304` | Parça boyutu (4 MB) |
| `YTDLP_AUTO_UPDATE` | `1` | Otomatik güncelleme (0=kapat) |
| `YTDLP_COOKIES_FILE` | — | YouTube cookies.txt yolu |
| `YTDLP_PLAYER_CLIENT` | — | YouTube player client override |

---

## 🧪 Hızlı Test Komutları

```bash
# Backend health check
curl http://localhost:8080/api/health

# Frontend typecheck
bun tsc -b --noEmit

# Python syntax check
python3 -m py_compile yt-dlp-server/main.py
python3 -m py_compile yt-dlp-server/chunked_downloader.py
python3 -m py_compile yt-dlp-server/resume_download.py
python3 -m py_compile yt-dlp-server/auto_update.py

# Lint
bun lint

# Full build test
bun run build
```

---

## 🐛 Sorun Giderme

### "No download engine" hatası
- APK/EXE olmadan tarayıcıda çalışıyorsan bu normal
- Sunucu URL'si ayarlıysa `VITE_YTDLP_SERVER_URL` kontrol et

### YouTube "Sign in to confirm you're not a bot"
- VPN'i kapat
- Cookies.txt import et (Gelişmiş → YouTube sorun giderme)

### APK build başarısız
- `package-lock.json` repo'da var mı kontrol et
- `JAVA_HOME` ve `ANDROID_HOME` ayarlı mı kontrol et
- `bun run build` önce çalıştır (frontend build)

### Artifacts quota hatası (GitHub Actions)
- Eski artifact'ları sil: `gh api repos/OWNER/REPO/actions/artifacts --paginate --jq '.artifacts[].id' | xargs -I{} gh api -X DELETE repos/OWNER/REPO/actions/artifacts/{}`
