---
name: update-extractor-dependencies
description: "Video platformlarının değişen algoritmalarına uyum sağlamak için indirme kütüphanelerini, regex extractor'ları ve bağımlılıkları günceller. İndirme motoru eskidiğinde veya platform değişiklikleri nedeniyle indirmeler patladığında bu yeteneği çalıştırın."
---

# update-extractor-dependencies

Bağımlılıkları ve extractor motorlarını en son sürüme yükselt, kırılan regex/parser kalıplarını tespit edip güncelle.

## Steps
1. **Bağımlılık Durumu Kontrolü:** Projedeki indirme kütüphanelerinin (yt-dlp, ffmpeg vb.) sürümlerini kontrol et.
2. **Upstream Taraması:** Ana kütüphanelerin en son güncellemelerini ve güvenlik yamalarını kontrol et.
3. **Deprecate Metot Değişimi:** Güncelleme sonrası deprecated (kullanımdan kaldırılan) metotları kod içinde tespit et ve yenileriyle değiştir.
4. **Test & Doğrulama:** Güncellenen bağımlılıkların mevcut build ve paketleme sistemine (Gradle/Maven/PyInstaller) uyumunu doğrula.