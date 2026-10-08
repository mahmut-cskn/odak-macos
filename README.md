# Odak

**Odaklan, planla, tamamla.** Odak, macOS menü çubuğunda yaşayan Türkçe bir Pomodoro ve görev planlayıcıdır. Hesap, sunucu, telemetri veya dış takvim bağlantısı yoktur. Verilerin bu Mac’te kalır.

![Odak açık tema](docs/screenshot-light.png)

## İndir ve kur

1. [Releases](https://github.com/mahmut-cskn/odak-macos/releases) sayfasından en yeni **Odak … universal.dmg** dosyasını indir. Aynı paket Apple Silicon ve Intel Mac’lerde çalışır; macOS 11 veya sonrası gerekir.
2. DMG’yi aç, **Odak** uygulamasını **Applications / Uygulamalar** klasörüne sürükle.
3. Uygulamalar’dan Odak’ı aç. Arayüz doğrudan görünür; Node.js, Rust veya bir editör kurman gerekmez.
4. İlk açılıştaki bildirim iznine **İzin Ver** de. Gerekirse **Sistem Ayarları → Bildirimler → Odak** bölümünden bildirimleri, afişleri ve sesleri aç.

Paket Apple Developer sertifikası olmadan **ad-hoc** imzalanır, Apple tarafından noterlenmemiştir. macOS engellerse uygulamaya **sağ tık → Aç** yap veya **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** yolunu kullan. İndirme kaynağının bu depo olduğundan emin olduktan sonra gerekirse Terminal’de:

```sh
xattr -cr /Applications/Odak.app
```

DMG indirmeleri için SHA-256 dosyası da aynı Release’te bulunur.

## Kullanım

- **Bugün:** Günün gündemi ve sayaç. Görevin sağındaki ▶ ile ona bağlı oturum başlat; **Odaklanmaya başla** ile serbest çalış.
- **Liste:** Tarih veya süre vermeden görev ekle. `…` menüsünden bugüne, yarına veya istediğin güne taşı.
- **Takvim:** Ay görünümünde tekrarların gelecekteki günlerini de gör; bir gün seç; o günün görevlerini, geçmişte tamamlananlar dahil gör. **Bu güne görev ekle** ile ileri bir tarihe plan yap.
- **Tamamlanan:** Görevin solundaki yuvarlakla tamamla. Buradaki ✓ yuvarlağına yeniden basınca görev eski gününe/listesine geri döner.
- **Ayarlar:** Çalışma **1–90 dakika**, mola **1–30 dakika**; varsayılan **45/15**. Serbest giriş vardır, hazır süre ön ayarları yoktur.

**Pomodoro görevi kendiliğinden tamamlamaz.** Bitmiş çalışma oturumları görevin toplam odak süresine eklenir. Tahmin girdiysen toplam süre tahminle birlikte gösterilir. Uzun bir işi günün gündemine alıp birden fazla oturumla ilerletebilirsin.

**Duraklat / Devam et** kalan süreyi korur. **İptal et** yalnızca o anki oturumu siler, hiçbir süre eklemez; önceden bitmiş oturumlar korunur. Çalışma bitince mola başlar; mola sonunda **Devam et** veya **5 dk daha** seçersin. Uygulamanın penceresini kapatmak sayacı durdurmaz. Menü çubuğundan **Çık** ile tamamen kapatsan bile tekrar açıldığında sayaç kayıtlı zaman damgasından hesaplanır. Uygulama tamamen kapalıyken bildirim gönderilemez; açılınca süresi geçen oturumlar kaydedilir.

## Planlama ve ek özellikler

- Süresiz görev, tahmini süre, son bitirme zamanı ve tarih + saat aralığı desteklenir.
- Saat aralıklı görevler başlamadan **15 dakika önce** sistem bildirimi gelir; bu süre ayarlardan değiştirilir. Başlangıç saati geçip bitişi henüz gelmemiş bir hatırlatma uygulama yeniden açıldığında gönderilir.
- Etiket ve renk seç; aynı etiketin rengi tüm görevlerde tutarlı kalır. Liste, Bugün, Tamamlanan ve Takvim’de etiket filtresi kullan.
- Günlük, seçili haftalık günler ve aylık tekrarlar vardır. Her günün örneği bağımsızdır; birini tamamlamak seriyi bitirmez. Aylık 31 gibi bir tarih olmayan aylarda atlanır. Seriyi Liste’nin altından düzenle. Seri düzenlemeleri gelecekteki başlanmamış örneklere uygulanır; tamamlananlar ve süre harcanmış örnekler korunur. Seriyi silmek gelecekteki başlanmamış örnekleri de kaldırır.
- Göreve not ve alt görev ekle. Alt görevlerin hepsi bitince ana görevi tamamlaman önerilir; otomatik tamamlanmaz.
- İstatistik simgesinden günlük/haftalık odak süresi, günler ve etiket dağılımını gör.
- Varsayılan **⌘⇧K** global kısayolu küçük bir hızlı ekleme penceresi açar. Başlığı yazıp **Enter** ile tarihsiz listeye kaydet; **Esc** ile kapat. Kısayol ayarlardan değiştirilir.
- Sistem açık/koyu temasını izler. Dock simgesi yoktur; menü çubuğu ikonuna basınca pencere açılır/kapanır. Sağ tık menüsünde **Çık** bulunur.

## Sesler ve otomatik başlatma

Yalnızca iki özgün, sinüsle sentezlenmiş yumuşak ses vardır: **Çalışma bitti** ve **Mola bitti**. Tik-tak sesi yoktur. Pomodoro bildirimi sessizdir, tonu Rust çalar; çift ses oluşmaz. Plan hatırlatmaları macOS’un sistem bildirim sesini kullanır. **Sesleri çal** ve **ses seviyesi** pomodoro tonlarını ayarlar. **Sessiz mod** tüm sesleri kapatır; bildirimler görünmeye devam eder.

**Oturum açınca başlat** ilk açılışta açıktır. Böylece menü çubuğunda yaşayan Odak planlı hatırlatmaları gönderebilir. Ayarlardan kapatabilirsin. Uygulamayı önce Uygulamalar klasörüne taşı; başlangıç kaydı uygulamanın kurulu yolunu kullanır.

## Yerel veri ve yedekleme

SQLite dosyası `~/Library/Application Support/com.mahmutcskn.odak/odak.sqlite3` konumundadır. Tam yol Ayarlar’da görünür. Görevler, bitmiş oturumlar, sayaç, ayarlar ve gönderilen hatırlatma kayıtları işlem bütünlüğüyle saklanır.

**Ayarlar → JSON dışa aktar** tüm veriyi tek dosyaya kaydeder. **JSON içe aktar** mevcut verilerin yerini seçtiğin yedekle değiştirir; önce otomatik `recovery-….json` kurtarma yedeği alınır. Çalışan/duraklatılmış sayacı içe aktarmadan önce iptal et. Aktif sayaç dışa aktarılabilir. Yedekler görev notlarını da içerdiğinden dosyanı güvenli bir yerde tut.

## Geliştirme

Son kullanıcı için gerekli değildir. Geliştirici gereksinimleri: macOS, Xcode Command Line Tools, Node.js LTS, Rust stable.

```sh
npm ci
npm run tauri dev
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx playwright install chromium
npm run test:ui
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

`v*` etiketi push edildiğinde GitHub Actions universal DMG oluşturup Release’e ekler. SQLite `rusqlite` ile pakete gömülüdür; zamanlayıcı, bildirim zamanlaması, ses ve menü çubuğu Rust’ta çalışır. React/TypeScript arayüz ve istatistikleri yönetir. macOS izin penceresi ve afişler için küçük bir `UNUserNotificationCenter` köprüsü kullanılır. Üretim arayüzü dış kaynağa ağ isteği yapamaz.

[Kararlar](DECISIONS.md) · [Doğrulama](docs/VALIDATION.md)
