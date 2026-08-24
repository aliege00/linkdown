---
name: debug-and-fix-video-downloader
description: "Video indirme uygulamasındaki (linkdown) hataları tespit etmek, logları analiz etmek, ağ/ayrıştırma/kod hatalarını teşhis etmek ve detaylı düzeltme adımları sunmak için kullanılır. Kullanıcı kod hatası, indirme başarısızlığı veya kütüphane/bağımlılık çökmesi bildirdiğinde bu yeteneği devreye sokun."
---

# debug-and-fix-video-downloader

Video indirme uygulamasındaki hataları kök nedenine kadar analiz et, bağımlılık (ytdlp, gradle/maven, ffmpeg vb.) ve ağ katmanlarını incele, eksiksiz ve güvenli kod düzeltmeleri sağla.

## Kapsam ve İnceleme Detayları
* **Ayrıştırma (Parsing) Hataları:** Platformların (YouTube, Instagram vb.) De-obfuscation veya HTML yapısı değişikliklerinden kaynaklı REGEX ve extractor çöküşleri.
* **Ağ ve İşleme Hataları:** Timeout, HTTP 403/429 (Rate Limit), User-Agent sorunları ve SSL handshake yetersizlikleri.
* **Medya / FFmpeg İşlemleri:** Video ve ses akışlarının (DASH/HLS) birleştirilememesi, format/codec uyuşmazlıkları ve yarıda kalan indirmeler.
* **Bağımlılık ve Yapılandırma (Build):** Gradle/Maven paket çakışmaları, deprecate olmuş kütüphane metotları ve yetki/dosya sistemi izinleri.

## Detay Hususları ve Kısıtlamalar
1. **Asla Yüzeyel Çözüm Sunma:** Sadece hatayı gizleyen `try-catch` blokları ekleme; hatanın kök nedenini belirle.
2. **Uç Durum (Edge Case) Kontrolü:** Ağ kopmaları, geçersiz/özel karakter içeren URL'ler ve sıfır baytlık dosya senaryolarını mutlaka hesaba kat.
3. **Log & Hata Yönetimi:** Düzeltme yaparken geliştiricinin debug edebilmesi için anlamlı hata mesajları ve yönlendirici Exception handling yapıları kurgula.

## Steps

1. **Hata Girdisini İzole Et ve Sınıflandır:**
   - Kullanıcının sunduğu hatayı/stack trace'i incele.
   - Hatanın kaynağını tespit et: *Network / Extractor (URL Parsing) / Storage & Permissions / Build & Dependencies*.

2. **Kök Neden Analizi (Root Cause Analysis):**
   - Kodun ilgili bölümünü ve ilgili isteğin yaşam döngüsünü (request lifecycle) adım adım takip et.
   - Eğer sorun sunucu taraflı bir engelleme (HTTP 403/429) ise header/User-Agent yapılarını kontrol et.
   - Eğer sorun FFmpeg birleştirmesi veya akış indirmesi ise format kodlarını ve geçici dosya yazma yetkilerini incele.

3. **Çözümü Planla ve Yan Etkileri (Side-Effects) Değerlendir:**
   - Yapılacak düzeltmenin uygulamanın diğer indirme motorlarına zarar vermediğinden emin ol.
   - Kodun geriye dönük uyumluluğunu ve performans üzerindeki etkisini kontrol et.

4. **Düzeltmeyi ve Kodu Oluştur:**
   - Düzeltilmiş kod bloğunu tam ve eksiksiz olarak sağla (eksik parçalar veya `// buraya kod gelecek` gibi basitleştirmeler bırakma).
   - Değiştirilen satırları ve neden yapıldığını belirgin şekilde vurgula.

5. **Doğrulama ve Test Adımları:**
   - Hatanın tekrar etmediğini doğrulamak için uç durum senaryoları (edge cases) öner (örn: geçersiz URL, yavaş bağlantı, yetkisiz dizin).