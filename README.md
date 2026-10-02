# VidFetch

[![Build APK](https://github.com/aliege00/linkdown/actions/workflows/build-apk.yml/badge.svg)](https://github.com/aliege00/linkdown/actions/workflows/build-apk.yml) [![Release](https://github.com/aliege00/linkdown/actions/workflows/release.yml/badge.svg)](https://github.com/aliege00/linkdown/actions/workflows/release.yml)

VidFetch; indirme işini **cihazda** yapan bir video indiricidir. yt-dlp motoru uygulamanın
içine gömülüdür — sunucu yok, hesap yok, oturum yok. İki dağıtım kanalı vardır:

- **Android APK** — Capacitor + yerleşik yt-dlp (Python runtime) + FFmpeg
- **Windows EXE** — Electron (NSIS kurulum + portable), yt-dlp + ffmpeg paketli

Web sitesi (bu repo) yalnızca vitrin + uygulamadır: tarayıcıda indirme motoru **çalışmaz**,
site indirme linklerini gösterir.

## 📥 İndirme

Linkler her zaman **en son release'i** gösterir; sürüm değişince elle güncelleme gerekmez
(CI her release'e sabit adlı kopya asset'ler yükler, aşağıdaki "Release süreci" bölümüne bakın):

| Platform | Link |
|---|---|
| Android APK | https://github.com/aliege00/linkdown/releases/latest/download/VidFetch-latest.apk |
| Windows kurulum | https://github.com/aliege00/linkdown/releases/latest/download/VidFetch-Setup-latest.exe |
| Windows portable | https://github.com/aliege00/linkdown/releases/latest/download/VidFetch-latest-portable.exe |
| Tüm sürümler | https://github.com/aliege00/linkdown/releases |

**Android kurulumu:** APK'yı indirin → tarayıcınıza "Bilinmeyen uygulamalar kur" izni verin
(Ayarlar → Uygulamalar) → APK'yı açın. Bu izin, uygulamanın Play Store dışından
dağıtıldığı için gereklidir.

**SHA-256 doğrulama (isteğe bağlı):** Her release'in notlarında APK'nın SHA-256 özeti
yazar. İndirdiğiniz dosyayı doğrulamak için:

```bash
shasum -a 256 VidFetch-vX.Y.Z.apk   # macOS/Linux
certutil -hashfile VidFetch-vX.Y.Z.apk SHA256   # Windows
```

## 🛠️ Geliştirme

```bash
npm install          # bağımlılıklar
npm run dev          # Vite dev sunucusu (tarayıcı — indirme motoru yok, sadece arayüz)
npm run typecheck    # tsc -b --noEmit
npm test             # vitest
npm run build        # üretim build'i (dist/)
```

Android build (yerel, debug imzalı — CI'daki release akışı aşağıda):

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease   # imza env'leri yoksa debug key'e düşer
```

Windows EXE build:

```bash
npm run build && npx electron-builder --config electron-builder.yml --win nsis portable --publish never
```

## 🚀 Release süreci

1. Versiyonları güncelleyin (`package.json`, `index.html` __VIDFETCH_BUILD__,
   `android/app/build.gradle` — CI tag'den yeniden damgalar).
2. Tag oluşturun ve push edin:

   ```bash
   git tag v2.6.3
   git push origin main v2.6.3
   ```

3. İki workflow otomatik çalışır:
   - **build-apk.yml** → tek universal, imzalı APK + `SHA256.txt`
   - **release.yml** → APK + Windows EXE'ler (NSIS + portable) ve GitHub Release

   Release notlarına APK'nın SHA-256 özeti otomatik yazılır.
4. Her release'e üç **sabit adlı kopya** da yüklenir: `VidFetch-latest.apk`,
   `VidFetch-Setup-latest.exe`, `VidFetch-latest-portable.exe`. Sitedeki ve README'deki
   `releases/latest/download/...` linkleri bu kopyalara işaret eder — böylece sürüm
   numarası değişince linkleri güncellemek gerekmez.

APK dosya adı sürüm içerir: `VidFetch-v2.6.3.apk` (tek universal APK — arm64 + arm32 +
x86_64 hepsi tek dosyada; ABI split yok). `versionCode` tag'den hesaplanır:
`major*10000 + minor*100 + patch` (v2.6.3 → 20603).

## 🔐 Release imzalama kurulumu

Release APK'lar GitHub Secrets'tan okunan bir keystore ile imzalanır. **Keystore dosyasını
ASLA repoya commit etmeyin** (`android/app/release.keystore` yalnızca CI runner'ında
oluşturulur).

### 1. Keystore oluşturun (tek seferlik, kendi makinenizde)

```bash
keytool -genkeypair -v -keystore release.keystore -alias vidfetch \
  -keyalg RSA -keysize 2048 -validity 10000
```

> ⚠️ Bu keystore'u güvenli bir yerde yedekleyin. Kaybederseniz kullanıcılar eski
> sürümün üzerine yeni sürümü kuramaz (imza değişir) — uygulamayı kaldırıp kurmak gerekir.

### 2. Keystore'u base64'e çevirin

```bash
base64 -w0 release.keystore      # Linux (macOS: base64 -i release.keystore)
```

### 3. GitHub Secrets ekleyin

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Değer |
|---|---|
| `SIGNING_KEY` | Yukarıdaki base64 çıktının tamamı |
| `SIGNING_STORE_PASSWORD` | keytool sırasında girdiğiniz store parolası |
| `SIGNING_KEY_ALIAS` | `vidfetch` (veya seçtiğiniz alias) |
| `SIGNING_KEY_PASSWORD` | key parolası (store ile aynıysa onu girin) |

Secret'lar eksikse CI bilinçli olarak **fail** eder — debug imzalı APK sessizce
yayınlamaz. Yerel build'lerde env değişkenleri yoksa imza, SDK debug key'ine düşer
(yalnızca geliştirme için).

## 🔒 Güvenlik notları

- **Electron:** `contextIsolation: true`, `nodeIntegration: false`; renderer ile native
  köprü yalnızca `electron/preload.cjs` üzerinden geçer.
- **URL doğrulama:** İndirme akışına giren linkler `src/lib/url.ts` içinde normalize
  edilir; yalnızca `http://` ve `https://` şemaları kabul edilir (`ftp:`, `javascript:`
  vb. reddedilir).
- **Cookies import (login değildir):** "Gelişmiş → YouTube sorun giderme" ekranındaki
  cookies.txt içe aktarma özelliği bir hesap/oturum sistemi değildir; kullanıcı kendi
  tarayıcı çerez dosyasını cihaza seçer ve dosya yalnızca uygulamanın özel deposunda
  (`filesDir`) tutularak yt-dlp'ye `--cookies` argümanıyla verilir. Sunucuya hiçbir şey
  gönderilmez.

## ⚖️ Yasal

- [Gizlilik Politikası](https://vidfetch.app/legal/privacy) ·
  [Kullanım Şartları](https://vidfetch.app/legal/terms) ·
  [Telif Uyarısı](https://vidfetch.app/legal/copyright)
  (site içi yollar: `/legal/privacy`, `/legal/terms`, `/legal/copyright`)

VidFetch hiçbir içerik sunmaz/saklamaz; indirme cihazınızda gerçekleşir. Yalnızca hakkına
sahip olduğunuz veya indirme izni verilen içerikleri indirin; platformların kullanım
şartlarına uymak kullanıcı sorumluluğundadır. Bu README ve repodaki yasal sayfalar
**hukuki danışmanlık değildir**.

## 📄 Lisans

Bu projenin lisansı için LICENSE dosyasına bakın.
