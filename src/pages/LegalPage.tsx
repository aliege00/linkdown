import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Download, Scale, Shield, Copyright } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * LegalPage — Gizlilik Politikası / Kullanım Şartları / Telif Uyarısı.
 *
 * One component serves all three documents (TR + EN). The app is fully
 * on-device, so the content reflects that: no data leaves the device, and
 * the user is responsible for what they download.
 *
 * NOTE: This is not legal advice — see the note in README.md.
 */

type LegalDoc = "privacy" | "terms" | "copyright";

const CONTACT_EMAIL = "vidfetch.app@gmail.com";
const SITE_URL = "https://vidfetch.app";

const DOCS: Record<
  LegalDoc,
  {
    title: Record<"tr" | "en", string>;
    icon: typeof Shield;
    updated: string;
    sections: Record<"tr" | "en", { h: string; p: string }[]>;
  }
> = {
  privacy: {
    title: { tr: "Gizlilik Politikası", en: "Privacy Policy" },
    icon: Shield,
    updated: "2026-10-01",
    sections: {
      tr: [
        {
          h: "Özet",
          p: `VidFetch hesap istemez, kayıt tutmaz ve veri toplamaz. Video bağlantıları ve indirilen dosyalar yalnızca senin cihazında işlenir; ${SITE_URL} üzerinden veya uygulamadan hiçbir içerik sunucumuza gönderilmez — çünkü böyle bir sunucu yoktur.`,
        },
        {
          h: "Hangi veriler cihazda tutulur?",
          p: "İndirme geçmişi (başlık, bağlantı, kalite, zaman) yalnızca cihazının kendi depolamasında (localStorage) tutulur ve yalnızca sen görebilirsin. Uygulamayı sildiğinde bu veriler de silinir.",
        },
        {
          h: "İnternet trafiği",
          p: "Bir video indirdiğinde uygulama, videoyu doğrudan video platformunun kendi sunucularından cihazına indirir. Bağlantı noktan ile platform arasında aracımız yoktur; ne görür ne de kaydederiz. Yapıştırma kutusuna yazdığın metin hiçbir yere gönderilmez.",
        },
        {
          h: "Çerezler ve izleyiciler",
          p: "Sitede reklam izleyicisi, analitik pikseli veya üçüncü taraf çerezi kullanılmaz. (İleri düzey YouTube sorun gidermesinde kullanılan, kullanıcının kendi seçtiği cookies.txt dosyası bu politikanın kapsamı dışında tamamen cihazda kalır.)",
        },
        {
          h: "Çocukların gizliliği",
          p: "Uygulama 13 yaş altına yönelik değildir ve bilinçli olarak bu yaştan küçüklerden veri toplamaz.",
        },
        {
          h: "İletişim",
          p: `Soruların için: ${CONTACT_EMAIL}`,
        },
      ],
      en: [
        {
          h: "Summary",
          p: `VidFetch requires no account, keeps no logs and collects no data. Video links and downloaded files are processed entirely on your device; no content is ever sent to our servers from the app or ${SITE_URL} — because no such server exists.`,
        },
        {
          h: "What is stored on the device?",
          p: "Download history (title, link, quality, time) lives only in your device's own storage (localStorage) and is visible only to you. Uninstalling the app deletes it.",
        },
        {
          h: "Network traffic",
          p: "When you download a video, the app fetches it directly from the video platform's own servers to your device. There is no middleman service in between: we see, store and log nothing. Text you type into the paste box goes nowhere.",
        },
        {
          h: "Cookies and trackers",
          p: "The site uses no ad trackers, analytics pixels or third-party cookies. (The optional cookies.txt file a user chooses themselves in advanced YouTube troubleshooting also stays on-device and is outside this policy's data flows.)",
        },
        {
          h: "Children's privacy",
          p: "The app is not directed at children under 13 and does not knowingly collect data from them.",
        },
        {
          h: "Contact",
          p: `Questions: ${CONTACT_EMAIL}`,
        },
      ],
    },
  },
  terms: {
    title: { tr: "Kullanım Şartları", en: "Terms of Use" },
    icon: Scale,
    updated: "2026-10-01",
    sections: {
      tr: [
        {
          h: "Kabul",
          p: `VidFetch'i (${SITE_URL} ve mobil/masaüstü uygulamaları) kullanarak bu şartları kabul etmiş olursun. Şartları kabul etmiyorsan uygulamayı kullanma.`,
        },
        {
          h: "Uygulamanın amacı",
          p: "VidFetch, cihazında çalışan kişisel bir video indirme aracıdır. Bir sunucu barındırmaz; indirme işlemi doğrudan senin cihazın ile video platformu arasında gerçekleşir.",
        },
        {
          h: "Senin sorumluluğun",
          p: "Yalnızca hakkına sahip olduğun, izin verilmiş veya kişisel kullanımına serbest olan içerikleri indirmelisin. Platformların (YouTube, TikTok, Instagram, X vb.) kullanım şartlarına uymak tamamen senin sorumluluğundadır. Bazı platformlar şartlarında indirmeyi kısıtlayabilir — bu kısıtlara uymak senin yükümlülüğündedir.",
        },
        {
          h: "Yasal kullanım",
          p: "Uygulamayı telif hakkı ihlali, korumalı içeriğe izinsiz erişim veya yerel yasalara aykırı herhangi bir amaç için kullanmak yasaktır. Bu şartlara aykırı kullanımdan doğan tüm hukuki sonuçlardan kullanıcı sorumludur.",
        },
        {
          h: "Garanti reddi",
          p: "Uygulama \"olduğu gibi\" sunulur. Video platformlarındaki değişiklikler nedeniyle bazı siteler geçici olarak çalışmayabilir; kesintisiz hizmet garantisi verilmez.",
        },
        {
          h: "Değişiklikler",
          p: "Bu şartlar zaman zaman güncellenebilir. Güncel sürüm her zaman bu sayfada yayımlanır.",
        },
      ],
      en: [
        {
          h: "Acceptance",
          p: `By using VidFetch (${SITE_URL} and the mobile/desktop apps) you accept these terms. If you do not accept them, do not use the app.`,
        },
        {
          h: "Purpose",
          p: "VidFetch is a personal video downloader that runs on your device. It hosts no server; the download happens directly between your device and the video platform.",
        },
        {
          h: "Your responsibility",
          p: "Only download content you own, that is permitted, or that is free for personal use. Complying with each platform's terms of service (YouTube, TikTok, Instagram, X, etc.) is solely your responsibility. Some platforms restrict downloading in their terms — respecting those restrictions is your obligation.",
        },
        {
          h: "Lawful use",
          p: "You may not use the app for copyright infringement, unauthorized access to protected content, or any purpose that violates your local laws. The user bears all legal consequences of misuse.",
        },
        {
          h: "Disclaimer of warranty",
          p: "The app is provided \"as is\". Platform-side changes may temporarily break support for some sites; no uptime guarantee is given.",
        },
        {
          h: "Changes",
          p: "These terms may be updated over time. The current version is always published on this page.",
        },
      ],
    },
  },
  copyright: {
    title: { tr: "Telif Uyarısı", en: "Copyright Notice" },
    icon: Copyright,
    updated: "2026-10-01",
    sections: {
      tr: [
        {
          h: "Konumumuz",
          p: "VidFetch bir içerik barındırmaz, arşivlemez ve aramaz. Hiçbir video dosyası bizim tarafımızda tutulmaz; uygulama yalnızca kullanıcının kendi cihazında çalışan bir araçtır.",
        },
        {
          h: "Telif hakkı sahipleri",
          p: "Eserinin VidFetch üzerinden izinsiz indirildiğini veya paylaşıldığını düşünüyorsan bize yaz: DMCA benzeri bir süreç için eseri tanımlayıcı bilgileri (bağlantı, eser adı, sahiplik kanıtı) içeren bir e-posta gönder. Geçerli talepleri değerlendirir, gerektiğinde uygulamada ilgili sitenin desteğini kısıtlayabiliriz.",
        },
        {
          h: "Kullanıcı uyarısı",
          p: "Başkasının telifli içeriğini izinsiz indirmek ve paylaşmak, bulunduğun ülkede hukuki sorumluluk doğurabilir. VidFetch'i yalnızca yasal amaçlarla kullan.",
        },
        {
          h: "İletişim",
          p: `Telif talepleri: ${CONTACT_EMAIL}`,
        },
      ],
      en: [
        {
          h: "Our position",
          p: "VidFetch hosts, archives and indexes nothing. No video file is ever held by us; the app is a tool that runs on the user's own device.",
        },
        {
          h: "For copyright holders",
          p: "If you believe your work is being downloaded or shared via VidFetch without permission, write to us: send an email with identifying details of the work (link, title, proof of ownership) for a DMCA-like process. We review valid claims and may restrict support for the relevant site in the app when necessary.",
        },
        {
          h: "User warning",
          p: "Downloading and redistributing someone else's copyrighted content without permission may carry legal consequences in your country. Use VidFetch only for lawful purposes.",
        },
        {
          h: "Contact",
          p: `Copyright claims: ${CONTACT_EMAIL}`,
        },
      ],
    },
  },
};

function isLegalDoc(v: string | undefined): v is LegalDoc {
  return v === "privacy" || v === "terms" || v === "copyright";
}

export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const navigate = useNavigate();
  // Assumption: default the UI language to Turkish (the app's primary
  // audience) — the EN toggle is one tap away. No router-level i18n exists.
  const lang: "tr" | "en" =
    (localStorage.getItem("vidfetch.helpLang") as "tr" | "en") || "tr";
  void lang; // picked up via the toggle below at render time

  const active: LegalDoc = isLegalDoc(doc) ? doc : "privacy";
  const info = DOCS[active];

  useEffect(() => {
    document.title = `${info.title[lang]} — VidFetch`;
    return () => {
      document.title = "VidFetch - Free Video Downloader";
    };
  }, [info, lang]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4" />
            {lang === "tr" ? "Geri" : "Back"}
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Download className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold">VidFetch</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        {/* Document switcher */}
        <div className="mb-6 flex flex-wrap gap-2">
          {(Object.keys(DOCS) as LegalDoc[]).map((d) => {
            const DocIcon = DOCS[d].icon;
            const isActive = d === active;
            return (
              <button
                key={d}
                type="button"
                onClick={() => navigate(`/legal/${d}`)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer " +
                  (isActive
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border/70")
                }
              >
                <DocIcon className="h-3.5 w-3.5" />
                {DOCS[d].title[lang]}
              </button>
            );
          })}
        </div>

        {/* Title + date */}
        <h1 className="text-2xl font-bold tracking-tight">
          {info.title[lang]}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {lang === "tr" ? "Son güncelleme" : "Last updated"}: {info.updated}
        </p>

        {/* Sections */}
        <div className="mt-8 space-y-7">
          {info.sections[lang].map((s) => (
            <section key={s.h}>
              <h2 className="text-sm font-semibold text-foreground">{s.h}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {s.p}
              </p>
            </section>
          ))}
        </div>

        <p className="mt-10 text-[11px] leading-relaxed text-muted-foreground/60">
          {lang === "tr"
            ? "Bu belgeler genel bilgilendirme amaçlıdır ve hukuki danışmanlık niteliği taşımaz."
            : "These documents are provided for general information and do not constitute legal advice."}
        </p>
      </main>
    </div>
  );
}
