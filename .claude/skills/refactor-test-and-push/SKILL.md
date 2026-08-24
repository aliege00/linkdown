---
name: refactor-test-and-push
description: "Projedeki kodlari bastan sona analiz eder, performans/mimari gelistirmeler yapar, kodun tamamini test ederek doğruluk kontrolü saglar ve degisiklikleri githuba push ederek workflowlari tetikler."
---

# refactor-test-and-push

Kod tabanını derinlemesine incele, güvenli geliştirmeler/iyileştirmeler yap, tüm testlerle doğrula ve GitHub'a push ederek CI/CD akışını başlat.

## Temel Kurallar ve Kısıtlamalar
1. **Bütünsel İnceleme:** Kod parçalaması yapmadan önce projenin genel yapısını ve bağımlılıklarını eksiksiz oku.
2. **Kırmadan İlerleme (Zero Breaking Changes):** Eklenen veya iyileştirilen fonksiyonlar mevcut işlevleri bozmamalıdır.
3. **Tam Test Kapsamı:** Push yapmadan önce var olan ve yeni eklenen tüm testlerin yerel ortamda geçtiğinden emin ol.
4. **Temiz Git Geçmişi:** Anlamlı commit mesajları kullan ve push öncesi uncommitted dosya bırakma.

## Steps

1. **Kod Tabanını Baştan Sına Oku ve Analiz Et:**
   - Projedeki tüm kaynak dosyaları, mimariyi ve bağımlılıkları incele.
   - Kod kalitesi, performans darboğazları, tip güvenlikleri ve potansiyel refactor alanlarını belirle.

2. **Geliştirme ve İyileştirme Uygula:**
   - Tespit edilen alanlarda geliştirmeleri (kod optimizasyonu, bellek yönetimi, yeni modül veya refactor) uygula.
   - Kod okunabilirliğini artır ve eksik dokümantasyonları/tip tanımlarını tamamla.

3. **Bütünsel Test ve Doğrulama:**
   - Değişiklik yapılan kısımlar dahil projedeki tüm testleri çalıştır.
   - Yeni eklenen/geliştirilen işlevsellikler için gerekli birim (unit) veya entegrasyon testlerini yaz.
   - Herhangi bir regresyon (regression) veya çökme olmadığını doğrula.

4. **Git ve CI/CD Tetikleme (Push):**
   - Yapılan değişiklikleri kontrol et (`git status` / `git diff`).
   - Değişiklikleri commit et ve remote depoya push et (`git push origin <branch-name>`).
   - Push sonrası GitHub Actions / Workflow sürecinin başladığını doğrula.

