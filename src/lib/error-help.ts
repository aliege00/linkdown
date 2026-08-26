/**
 * Error explainer for VidFetch.
 *
 * Turns raw yt-dlp / engine error strings ("ERROR: [generic] '...' is not a
 * valid URL", "Sign in to confirm you're not a bot", …) into short,
 * plain-language explanations (TR + EN) with actionable steps, so users
 * don't have to decode technical messages.
 */

import type { HelpLang } from "./help-content";
export type { HelpLang } from "./help-content";

export type ErrorCategory =
  | "no-engine"
  | "bot-check"
  | "invalid-url"
  | "private"
  | "age"
  | "geo"
  | "login"
  | "paid"
  | "network"
  | "ffmpeg"
  | "playlist"
  | "generic";

export interface ErrorExplanation {
  category: ErrorCategory;
  /** Short heading for the error box. */
  title: string;
  /** Plain-language description of what happened. */
  message: string;
  /** Actionable steps, best first. */
  steps: string[];
  /** Cleaned raw error for the "technical detail" block. */
  technical: string;
}

/**
 * Clean up raw engine output so it can be shown to users:
 * - drops "Deprecated Feature" / debug noise lines
 * - strips "ERROR: [extractor]: " prefixes
 * - keeps only the first meaningful line, truncated
 */
export function sanitizeRawError(raw: string): string {
  if (!raw) return "";

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^deprecated feature:/i.test(l)) return false; // yt-dlp option warnings
      if (/^\[debug\]/i.test(l)) return false;
      if (/^warning:/i.test(l) && /deprecated/i.test(l)) return false;
      return true;
    });

  let text = (lines[0] ?? raw).trim();
  // "ERROR: [generic] " → "" (yt-dlp tags may or may not end with a colon)
  text = text.replace(/^(ERROR:\s*)?(\[[^\]]+\]:?\s*)+/i, "").trim();
  // yt-dlp often keeps the video id after the tag: "[youtube] dQw4…: msg"
  // → strip a short word/ID + colon prefix so users see just the message.
  text = text.replace(/^[\w-]{1,64}:\s+/, "").trim();
  // Trailing "See https://github.com/yt-dlp/yt-dlp#... for more info"
  text = text.replace(/\s*See https:\/\/github\.com\/yt-dlp\/yt-dlp.*$/i, "").trim();
  // Trim long stack-ish tails
  const at = text.indexOf("\n");
  if (at !== -1) text = text.slice(0, at).trim();
  if (text.length > 400) text = `${text.slice(0, 400)}…`;
  return text;
}

const COPY: Record<
  ErrorCategory,
  { tr: { title: string; message: string; steps: string[] }; en: { title: string; message: string; steps: string[] } }
> = {
  "no-engine": {
    tr: {
      title: "İndirme motoru burada yok",
      message:
        "Bu önizleme bir tarayıcıda çalışıyor; indirme motoru yalnızca Android APK ve Windows EXE uygulamalarının içinde bulunuyor. Sunucu yok, API anahtarı yok, sınır yok.",
      steps: [
        "Android APK veya Windows EXE sürümünü kur",
        "Video bağlantısını uygulama içine yapıştır",
        "Kaliteyi seç ve indir",
      ],
    },
    en: {
      title: "No download engine here",
      message:
        "This preview runs in a browser, where there is no download engine. The engine ships inside the Android APK and the Windows EXE. No server, no API key, no limits.",
      steps: [
        "Install the Android APK or the Windows EXE",
        "Paste the video link inside the app",
        "Pick a quality and download",
      ],
    },
  },
  "bot-check": {
    tr: {
      title: "YouTube bot kontrolüne takıldı",
      message:
        "YouTube bu isteği şüpheli buldu ve \"Devam etmek için giriş yapın\" benzeri bir doğrulama istiyor. Bu, uygulamanın hatası değildir; VPN, veri merkezi veya ortak ağlardan gelen isteklerde sıkça görülür.",
      steps: [
        "VPN'i kapat (en hızlı çözüm)",
        "Giriş yaptığın tarayıcıdan cookies içe aktar (Gelişmiş → YouTube sorun giderme)",
        "Birkaç dakika bekleyip tekrar dene",
        "Aşağıdaki yardım rehberini incele",
      ],
    },
    en: {
      title: "YouTube bot check",
      message:
        "YouTube flagged this request as suspicious and is asking for a \"Sign in to confirm you're not a bot\" verification. This is not a bug in the app — it's common for requests coming from VPNs, datacenter or shared networks.",
      steps: [
        "Turn your VPN off (fastest fix)",
        "Import cookies from a browser where you are logged in (Advanced → YouTube troubleshooting)",
        "Wait a few minutes and try again",
        "Read the help guide below",
      ],
    },
  },
  "invalid-url": {
    tr: {
      title: "Bağlantı tanınamadı",
      message:
        "Yapıştırdığın bağlantı geçerli bir video adresi gibi görünmüyor ya da bu site şu an desteklenmiyor.",
      steps: [
        "Bağlantıyı tarayıcının adres çubuğundan tam olarak kopyala",
        "Desteklenen bir siteden video bağlantısı kullan (YouTube, TikTok, Twitter/X, Instagram, Vimeo…)",
        "Yalnızca video sayfasının adresini yapıştır",
      ],
    },
    en: {
      title: "Link not recognized",
      message:
        "The link you pasted doesn't look like a valid video URL, or this site isn't supported right now.",
      steps: [
        "Copy the full link from your browser's address bar",
        "Use a video link from a supported site (YouTube, TikTok, Twitter/X, Instagram, Vimeo…)",
        "Paste only the video page address",
      ],
    },
  },
  private: {
    tr: {
      title: "Video gizli veya kaldırılmış",
      message:
        "Bu video gizli, kaldırılmış ya da artık kullanılamıyor; bu yüzden indirilemiyor.",
      steps: [
        "Videonun tarayıcıda açılıp açılmadığını kontrol et",
        "Başka bir video dene",
      ],
    },
    en: {
      title: "Video is private or removed",
      message:
        "This video is private, has been removed, or is no longer available, so it can't be downloaded.",
      steps: [
        "Check whether the video opens in your browser",
        "Try a different video",
      ],
    },
  },
  age: {
    tr: {
      title: "Yaş sınırı olan video",
      message:
        "Bu video yaş sınırına tabi. YouTube, bu tür videolara doğrulama istemeden erişimi engelleyebiliyor.",
      steps: [
        "YouTube hesabınla tarayıcıda oturum aç",
        "Tarayıcı cookies'ini içe aktar (Gelişmiş → YouTube sorun giderme)",
      ],
    },
    en: {
      title: "Age-restricted video",
      message:
        "This video is age-restricted. YouTube can block access to such videos without a verification step.",
      steps: [
        "Log into YouTube in your browser",
        "Import browser cookies (Advanced → YouTube troubleshooting)",
      ],
    },
  },
  geo: {
    tr: {
      title: "Video bölgende kullanılamıyor",
      message:
        "Video, bulunduğun bölgede yayınlanmadığı için erişilemiyor (bölge kısıtlaması).",
      steps: [
        "Başka bir bölgede yayınlanmış bir video dene",
        "VPN kullanıyorsan kapat ya da farklı bir sunucu dene",
      ],
    },
    en: {
      title: "Video not available in your region",
      message:
        "The video isn't published in your region, so it can't be accessed (geo-restriction).",
      steps: [
        "Try a video that is published in your region",
        "If you use a VPN, turn it off or switch servers",
      ],
    },
  },
  login: {
    tr: {
      title: "Giriş gerekiyor",
      message:
        "Bu site, içeriği indirmek için bir hesaba giriş yapılmasını istiyor.",
      steps: [
        "Sitede hesabına giriş yap",
        "Tarayıcı cookies'ini içe aktar ve tekrar dene",
      ],
    },
    en: {
      title: "Login required",
      message:
        "This site requires you to be logged into an account before its content can be downloaded.",
      steps: [
        "Log into your account on the site",
        "Import browser cookies and try again",
      ],
    },
  },
  paid: {
    tr: {
      title: "Ücretli / premium içerik",
      message:
        "Bu içerik yalnızca siteye abone olan veya ödeme yapan kullanıcılara açık; ücretsiz erişimle indirilemiyor.",
      steps: [
        "İçeriğin ücretsiz örneğini (tanıtım vb.) dene",
        "Erişimin olan bir hesapla oturum açtıysan tekrar dene",
      ],
    },
    en: {
      title: "Paid / premium content",
      message:
        "This content is only available to subscribers or paying users, so it can't be downloaded without access.",
      steps: [
        "Try a free sample of the content (e.g. a trailer)",
        "If you have an account with access, log in and retry",
      ],
    },
  },
  network: {
    tr: {
      title: "İnternet bağlantısı sorunu",
      message:
        "Uygulama video sunucusuna ulaşamadı. Bağlantı kesik, yavaş ya da ağ erişimi engellenmiş olabilir.",
      steps: [
        "İnternet bağlantını kontrol et",
        "VPN kullanıyorsan kapat ya da değiştir",
        "Birkaç saniye bekleyip tekrar dene",
      ],
    },
    en: {
      title: "Internet connection problem",
      message:
        "The app couldn't reach the video server. Your connection may be down, slow, or the network may be blocking access.",
      steps: [
        "Check your internet connection",
        "Turn your VPN off or switch servers",
        "Wait a few seconds and try again",
      ],
    },
  },
  ffmpeg: {
    tr: {
      title: "Ses birleştirme başarısız",
      message:
        "Video ve ses ayrı dosyalar olarak indirildi, ancak birleştirme (ffmpeg) sırasında bir sorun oluştu.",
      steps: [
        "Daha düşük bir kalite seç (ör. 1080p)",
        "Uygulamayı güncelle ve tekrar dene",
      ],
    },
    en: {
      title: "Audio merge failed",
      message:
        "The video and audio were downloaded as separate files, but merging them (ffmpeg) failed.",
      steps: [
        "Pick a lower quality (e.g. 1080p)",
        "Update the app and try again",
      ],
    },
  },
  playlist: {
    tr: {
      title: "Video listesi işlenemedi",
      message:
        "Video listesi (playlist) tam olarak işlenemedi ya da listede indirilebilir video yok.",
      steps: [
        "Liste bağlantısının doğru olduğunu kontrol et",
        "Tek bir video bağlantısıyla dene",
      ],
    },
    en: {
      title: "Playlist couldn't be processed",
      message:
        "The playlist couldn't be processed, or it contains no downloadable videos.",
      steps: [
        "Check that the playlist link is correct",
        "Try a single video link",
      ],
    },
  },
  generic: {
    tr: {
      title: "Beklenmeyen bir sorun oluştu",
      message:
        "Bir şeyler yolunda gitmedi. Aşağıdaki teknik ayrıntı, sorun devam ederse destek ekibine yardımcı olur.",
      steps: [
        "İnternet bağlantını kontrol et",
        "Birkaç saniye bekleyip tekrar dene",
        "Uygulamayı kapatıp yeniden aç",
      ],
    },
    en: {
      title: "Something unexpected happened",
      message:
        "Something went wrong. The technical detail below helps the support team if the problem persists.",
      steps: [
        "Check your internet connection",
        "Wait a few seconds and try again",
        "Restart the app",
      ],
    },
  },
};

const MATCHERS: Array<{ category: ErrorCategory; pattern: RegExp }> = [
  {
    category: "no-engine",
    pattern:
      /(no download engine|runs in a browser|on your device — there is no server|no server\. install|download engine only exists|install one of those|no server, no api key|only exists inside the)/i,
  },
  {
    category: "bot-check",
    pattern:
      /(not a bot|sign in to confirm|confirm you'?re (not )?(a )?(human|bot)|captcha|recaptcha|unusual traffic|we'?ve detected|verify you'?re (not )?a (human|bot)|blocked.*bot|http error 403|http error 429|too many requests|rate.?limit|request throttl)/i,
  },
  {
    category: "invalid-url",
    pattern:
      /(is not a valid url|invalid url|unsupported url|does not look like a url|no video (found|with)|unable to extract|no url|not a url|url.*missing|\[object object\]|urlopen error.*invalid)/i,
  },
  {
    // Checked before "private": "not available in your country/region" is geo.
    category: "geo",
    pattern:
      /(geo[- ]restricted|geo restriction|not .{0,40}available in (your|this) (country|region)|blocked in your country|unavailable in (your|this) (country|region)|not available in your (country|region))/i,
  },
  {
    category: "private",
    pattern:
      /(private video|this video is private|video.*(is )?private|has been removed|removed video|no longer available|video is not available|unavailable|video unavailable|http error 404|404 not found)/i,
  },
  {
    category: "age",
    pattern:
      /(age[- ]restricted|age restriction|content warning|sign in to view|mature content|nsfw|adult content)/i,
  },
  {
    category: "network",
    pattern:
      /(timed? ?out|timeout|connection|network|offline|dns|getaddrinfo|econnrefused|enotfound|unable to connect|certificate|ssl|502|503|failed to resolve|no route)/i,
  },
  {
    category: "paid",
    pattern:
      /(paid content|premium content|members.?only|subscriber.?only|requires (a )?(premium|paid|pro) (account|subscription)|isn'?t available.*(premium|paywall)|paywall|exclusive content|only available to .*(premium|member|subscriber)|premium member|paid subscriber|only subscribers|only (premium|paid) (members|users|viewers))/i,
  },
  {
    category: "login",
    pattern:
      /(login required|log ?in required|requires (a )?login|must log in|authentication required|sign in required|please log ?in)/i,
  },
  {
    category: "ffmpeg",
    pattern: /(ffmpeg|postprocess|merging|conversion failed|avconv)/i,
  },
  {
    category: "playlist",
    pattern: /(playlist|flat playlist|entries)/i,
  },
];

/**
 * Explain a raw engine error in plain language for the given language.
 * Falls back to a friendly generic explanation when nothing matches.
 */
export function explainError(raw: string, lang: HelpLang): ErrorExplanation {
  const technical = sanitizeRawError(raw);
  const text = technical.toLowerCase();

  const match = MATCHERS.find((m) => m.pattern.test(text));
  const category: ErrorCategory = match?.category ?? "generic";
  const copy = COPY[category][lang];

  return {
    category,
    title: copy.title,
    message: copy.message,
    steps: copy.steps,
    technical,
  };
}
