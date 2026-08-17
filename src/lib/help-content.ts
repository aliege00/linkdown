/**
 * Bilingual help-center content (TR + EN).
 *
 * Lives in its own module so DownloaderCard.tsx stays small enough to edit
 * comfortably. The same content is written in plain language for end users,
 * with a language toggle in the card.
 */

export type HelpLang = "tr" | "en";

export const HELP_CONTENT = {
  tr: {
    kicker: "Yardım merkezi",
    title: "VidFetch yardım merkezi",
    copyLabel: "Kopyala",
    copiedLabel: "Kopyalandı",
    goToSettings: "Sorun giderme ayarlarını aç",
    tabs: {
      bot: "YouTube bot kontrolü",
      errors: "Sık hatalar",
      tips: "İpuçları",
    },
    bot: {
      introTitle: "Neden 'bot kontrolü' hatası alıyorum?",
      intro:
        "Bazen YouTube, bir videoyu indirmeye çalışırken \"Sign in to confirm you're not a bot\" (Devam etmek için giriş yapın) uyarısını gösterir ve erişimi engeller. Bu, uygulamanın hatası değildir. YouTube; VPN, veri merkezi veya ortak ağlardan gelen istekleri otomatik olarak şüpheli görür ve geçici olarak kısıtlar. Diğer siteler (Vimeo, TikTok, Instagram vb.) bu kontrolden etkilenmez — sorun yalnızca YouTube'a özeldir.",
      causesTitle: "En sık nedenler",
      causes: [
        "VPN, kurumsal veya veri merkezi ağına bağlı olman",
        "Tarayıcıda YouTube'a giriş yapılmamış olması",
        "Kısa sürede çok fazla indirme yapılması",
        "YouTube'un yeni bir altyapı değişikliği yayınlaması (birkaç gün sürebilir)",
      ],
      fixesTitle: "Nasıl çözülür?",
      fixes: [
        {
          badge: "Windows",
          title: "Tarayıcı cookies — en kolay yol",
          body: "Chrome, Edge veya Firefox'ta YouTube'a giriş yap. Uygulamada Gelişmiş → YouTube sorun giderme → Tarayıcı cookies bölümünden tarayıcını seç. İndirme sırasında tarayıcının kapalı veya kilidi açık olması gerekir.",
          settingsKey: "cookies",
        },
        {
          badge: "Android + Windows",
          title: "cookies.txt dosyası",
          body: "Tarayıcına \"Get cookies.txt LOCALLY\" eklentisini kur, YouTube'a giriş yap ve cookies dosyasını dışa aktar. Ardından uygulamada Gelişmiş → YouTube sorun giderme bölümünden bu dosyayı seç.",
          settingsKey: "cookies",
        },
        {
          badge: "Windows • İleri düzey",
          title: "PO token sağlayıcı",
          body: "Bilgisayarında token sunucusunu çalıştır, ardından uygulamaya http://127.0.0.1:4416 yaz ve Kaydet'e bas:",
          command: "docker run -d --init -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider",
          settingsKey: "po",
        },
      ],
      note: "Bu ayarlar yalnızca YouTube isteklerini etkiler ve Gelişmiş → YouTube sorun giderme bölümündedir. En güvenilir çözüm, giriş yaptığın bir tarayıcıdan cookies almaktır. VPN'i kapatmak da çoğu zaman yeterlidir.",
    },
    errors: {
      title: "Sık karşılaşılan hatalar",
      intro:
        "Aşağıdaki hatalardan birini görürsen panik yapma — çoğu birkaç saniyede çözülür. Her hata için ne anlama geldiği ve ne yapman gerektiği aşağıda.",
      items: [
        {
          title: "Geçersiz veya tanınmayan bağlantı",
          what: "Bağlantı bir video sayfasına ait değil ya da site desteklenmiyor.",
          fix: "Bağlantıyı tarayıcının adres çubuğundan kopyala; YouTube, TikTok, Twitter/X gibi desteklenen bir siteden video kullan.",
        },
        {
          title: "Video gizli veya kaldırılmış",
          what: "Video özel (private), kaldırılmış ya da artık kullanılamıyor.",
          fix: "Videonun tarayıcıda açılıp açılmadığını kontrol et; başka bir video dene.",
        },
        {
          title: "Yaş sınırı olan video",
          what: "YouTube, yaş sınırı olan videolara doğrulama istemeden erişimi engelleyebiliyor.",
          fix: "YouTube hesabınla tarayıcıda oturum aç ve tarayıcı cookies'ini içe aktar.",
        },
        {
          title: "Bölge kısıtlaması",
          what: "Video, bulunduğun ülkede/bölgede yayınlanmadığı için erişilemiyor.",
          fix: "Bölgende yayınlanan bir video dene; VPN kullanıyorsan kapat veya sunucu değiştir.",
        },
        {
          title: "İnternet bağlantısı",
          what: "Uygulama video sunucusuna ulaşamadı; bağlantı kesik, yavaş veya engellenmiş olabilir.",
          fix: "İnterneti kontrol et, VPN'i kapat, birkaç saniye bekleyip tekrar dene.",
        },
        {
          title: "Giriş gerekiyor",
          what: "Site, içeriği indirmek için hesaba giriş yapılmasını istiyor.",
          fix: "Sitede hesabına giriş yap; tarayıcı cookies'ini içe aktar ve tekrar dene.",
        },
        {
          title: "Ses birleştirme hatası (ffmpeg)",
          what: "Video ve ses ayrı indirildi ama birleştirilemedi.",
          fix: "Daha düşük bir kalite seç (ör. 1080p) veya uygulamayı güncelle.",
        },
        {
          title: "Diğer hatalar",
          what: "Yukarıdakilere benzemeyen bir sorun oluştu.",
          fix: "Birkaç dakika sonra tekrar dene; uygulamayı kapatıp yeniden aç. Sorun sürerse hatanın altındaki teknik ayrıntıyı not al.",
        },
      ],
    },
    tips: {
      title: "Genel ipuçları",
      items: [
        {
          title: "Tarayıcı cookies en güvenilir çözümdür",
          body: "YouTube'a giriş yaptığın tarayıcıdan cookies içe aktarmak bot kontrolünü aşmanın en etkili yoludur. Gelişmiş → YouTube sorun giderme bölümünden yapabilirsin.",
        },
        {
          title: "VPN'ini kapat",
          body: "VPN, kurumsal veya veri merkezi ağları YouTube tarafından şüpheli görülür. Kapatmak çoğu YouTube sorununu çözer.",
        },
        {
          title: "Bağlantıyı adres çubuğundan kopyala",
          body: "Kısa veya paylaşım bağlantıları yerine tarayıcının adres çubuğundaki tam URL'yi kullan; bu, analiz hatalarını azaltır.",
        },
        {
          title: "İnternetini kontrol et",
          body: "Yavaş veya kesintili bağlantı hem analiz hem indirme hatalarına yol açar. Wi-Fi yerine mobil veriyi de deneyebilirsin.",
        },
        {
          title: "Uygulamayı güncel tut",
          body: "Her güncelleme yeni site desteği ve hata düzeltmeleri getirir. Güncel sürüm kullandığından emin ol.",
        },
        {
          title: "Depolama alanını kontrol et",
          body: "Yetersiz depolama alanı indirmenin sessizce başarısız olmasına neden olabilir. Cihazında yeterli boş alan olduğundan emin ol.",
        },
      ],
    },
    stuck: {
      title: "Hâlâ çözülmedi mi?",
      body: "Yukarıdaki adımları denediysen ve hâlâ indiremiyorsan: uygulamanın güncel olduğundan emin ol, cihazı yeniden başlat ve başka bir video ile test et. Sorun yalnızca YouTube'da görünüyorsa birkaç saat sonra tekrar dene — YouTube zaman zaman geçici kısıtlamalar uygular.",
    },
  },
  en: {
    kicker: "Help center",
    title: "VidFetch help center",
    copyLabel: "Copy",
    copiedLabel: "Copied",
    goToSettings: "Open troubleshooting settings",
    tabs: {
      bot: "YouTube bot check",
      errors: "Common errors",
      tips: "Tips",
    },
    bot: {
      introTitle: "Why am I getting a 'bot check' error?",
      intro:
        "Sometimes YouTube shows \"Sign in to confirm you're not a bot\" and blocks access while you try to download a video. This is not a bug in the app. YouTube automatically treats requests coming from VPNs, datacenter or shared networks as suspicious and temporarily restricts them. Other sites (Vimeo, TikTok, Instagram, etc.) are not affected by this check — it only applies to YouTube.",
      causesTitle: "Most common causes",
      causes: [
        "You are on a VPN, corporate or datacenter network",
        "You are not logged into YouTube in your browser",
        "Too many downloads in a short period of time",
        "YouTube just rolled out an infrastructure change (may last a few days)",
      ],
      fixesTitle: "How to fix it",
      fixes: [
        {
          badge: "Windows",
          title: "Browser cookies — easiest way",
          body: "Log into YouTube in Chrome, Edge or Firefox. In the app open Advanced → YouTube troubleshooting → Browser cookies and pick your browser. The browser must be closed or unlocked while downloading.",
          settingsKey: "cookies",
        },
        {
          badge: "Android + Windows",
          title: "cookies.txt file",
          body: "Install the \"Get cookies.txt LOCALLY\" browser extension, log into YouTube and export the cookies file. Then choose that file under Advanced → YouTube troubleshooting in the app.",
          settingsKey: "cookies",
        },
        {
          badge: "Windows • Advanced",
          title: "PO token provider",
          body: "Run a token server on this PC, then enter http://127.0.0.1:4416 in the app and press Save:",
          command: "docker run -d --init -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider",
          settingsKey: "po",
        },
      ],
      note: "These settings only affect YouTube requests and live under Advanced → YouTube troubleshooting. The most reliable fix is importing cookies from a browser where you are logged in. Turning your VPN off also fixes most cases.",
    },
    errors: {
      title: "Common errors",
      intro:
        "If you see one of these errors, don't panic — most are fixed in seconds. Here's what each one means and what to do.",
      items: [
        {
          title: "Invalid or unrecognized link",
          what: "The link isn't a video page, or the site isn't supported.",
          fix: "Copy the link from your browser's address bar; use a video from a supported site like YouTube or TikTok.",
        },
        {
          title: "Video is private or removed",
          what: "The video is private, has been removed, or is no longer available.",
          fix: "Check whether the video opens in your browser; try a different video.",
        },
        {
          title: "Age-restricted video",
          what: "YouTube can block age-restricted videos without a verification step.",
          fix: "Log into YouTube in your browser and import browser cookies.",
        },
        {
          title: "Region restriction",
          what: "The video isn't published in your country or region.",
          fix: "Try a video published in your region; if you use a VPN, turn it off or switch servers.",
        },
        {
          title: "Internet connection",
          what: "The app couldn't reach the video server; the connection may be down, slow or blocked.",
          fix: "Check your internet, turn your VPN off, wait a few seconds and try again.",
        },
        {
          title: "Login required",
          what: "The site requires you to be logged into an account before downloading.",
          fix: "Log into your account on the site; import browser cookies and try again.",
        },
        {
          title: "Audio merge error (ffmpeg)",
          what: "Video and audio downloaded separately but couldn't be merged.",
          fix: "Pick a lower quality (e.g. 1080p) or update the app.",
        },
        {
          title: "Other errors",
          what: "Something that doesn't match the cases above happened.",
          fix: "Wait a few minutes and retry; restart the app. If it persists, note the technical detail shown under the error.",
        },
      ],
    },
    tips: {
      title: "General tips",
      items: [
        {
          title: "Browser cookies are the most reliable fix",
          body: "Importing cookies from a browser where you're logged into YouTube is the most effective way to get past the bot check. It lives under Advanced → YouTube troubleshooting.",
        },
        {
          title: "Turn your VPN off",
          body: "VPNs, corporate and datacenter networks look suspicious to YouTube. Turning it off fixes most YouTube issues.",
        },
        {
          title: "Copy the link from the address bar",
          body: "Use the full URL from your browser's address bar instead of short or share links; this avoids analysis errors.",
        },
        {
          title: "Check your internet",
          body: "Slow or flaky connections cause both analysis and download errors. You can also try mobile data instead of Wi-Fi.",
        },
        {
          title: "Keep the app updated",
          body: "Every update brings new site support and bug fixes. Make sure you're on the latest version.",
        },
        {
          title: "Check your storage",
          body: "Not enough free storage can make downloads fail silently. Make sure your device has free space.",
        },
      ],
    },
    stuck: {
      title: "Still stuck?",
      body: "If you tried the steps above and still can't download: make sure the app is up to date, restart the device, and test with another video. If the issue only shows on YouTube, try again in a few hours — YouTube occasionally applies temporary restrictions.",
    },
  },
} as const;
