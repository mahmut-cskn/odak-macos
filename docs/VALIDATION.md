# Doğrulama

Yerel doğrulama: 8 Ekim 2026, Apple Silicon macOS. Intel çalıştırılabiliri ayrıca universal pakete derlenmiştir; fiziksel Intel Mac testi yapılmamıştır.

## v1.0.0

- `npm run build`: TypeScript ve üretim Vite derlemesi geçti.
- `npm test`: 8 domain testi geçti; süresiz görevler, saat aralıkları, geçmişte tamamlanan takvim görevleri, haftalık istatistik ve süre hesabı.
- `cargo test --lib`: 7 Rust testi geçti; duraklama, SQLite roundtrip, iptalde kayıt olmaması, kapanma sonrasında iki fazın doğru tamamlanması, otomatik tamamlama olmaması, tekrar örnekleri ve limitler.
- `cargo clippy --all-targets -- -D warnings`: geçti.
- `npm run test:ui`: 6 Chromium testi geçti; görev ekleme/taşıma, tamamlama/geri alma, limit uyarısı, başlat/duraklat/devam/iptal, ileri tarihli saat aralığı, alt görev önerisi, etiket filtresi, ayarlar ve açık/koyu tema.
- Debug uygulama paketi gerçek Tauri komutları, SQLite, menü çubuğu, kısayol kaydı, native bildirim merkezi ve Rust ses servisiyle izole test dizininde çalıştırıldı. [Sonuç](native-test-v1.0.0.json).
- Uygulama gerçekten çıkıp aynı SQLite dosyasıyla yeniden başlatıldı. Çalışan sayaç kaldığı zamanı korudu; iptalde oturum yazılmadı. [Sonuç](native-restart-v1.0.0.json).
- macOS yerel bildirim merkezi çalışma/mola ve program bildirimlerini kabul etti; plan bildirimlerinin tekrar gönderilmemesi SQLite’ta doğrulandı. Bildirimlerin kullanıcıya gösterilmesi macOS izin ve Rahatsız Etme ayarlarına tabidir.
- `hdiutil verify`: DMG sağlama toplamı geçerli.
- `lipo -archs`: `x86_64 arm64`.
- `codesign --verify --deep --strict`: uygulama ad-hoc imzası geçerli.
- DMG bağlandı, kurulu `/Applications/Odak.app` çalıştırılabilirinin DMG içindekiyle aynı SHA-256 olduğu doğrulandı ve uygulama açıldı.
- 850×780 görünür yerel ana pencere, Accessory aktivasyon politikası, SQLite `integrity_check=ok` ve kurulu uygulama yolunu kullanan `RunAtLoad=true` LaunchAgent doğrulandı.
- Yerel WebView görüntüsü doğrudan WKWebView snapshot API’sinden alındı; sistem ekran kaydı veya erişilebilirlik izni gerekmedi. [Yerel görüntü](screenshot-native.png).
- `npm audit`: 0 açık.

Test köprüsü ve izole veri dizini yalnızca debug derlemelerinde vardır. Release uygulaması bu test komutlarını içermez. Tarayıcı UI testleri native IPC’yi mock eder; Rust ve yerel entegrasyon testleri gerçek native akışları ayrıca doğrular.

## Yeniden çalıştırma

```sh
npm ci
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npx playwright install chromium
npm run test:ui
npm run tauri build -- --target universal-apple-darwin
```

Yerel entegrasyon: başka Odak süreci kapalıyken `npm run tauri build -- --debug --bundles app` yap. Boş bir geçici dizini `ODAK_SMOKE_DIR` olarak verip paketin `Contents/MacOS/odak` çalıştırılabilirini `ODAK_SMOKE_EXIT=1` ile başlat. Aynı dizinle ikinci kez `ODAK_SMOKE_RESTORE=1` ekleyerek başlat. Sonuçlar `native.json`, `ui.json` ve `native-ui.png` dosyalarına yazılır. Gerçek kullanıcı verisi kullanılmaz; test modu otomatik başlatma kaydını değiştirmez.

## v1.1.0

- 13 Rust testi, 12 TypeScript domain testi ve 6 Chromium UI testi geçti; `cargo clippy --all-targets -- -D warnings` temiz ve `npm audit` 0 açık.
- Tekrar serisi düzenleme/silme testleri tamamlanan ve başlamış örneklerin geçmişini koruduğunu doğrular.
- Etiket rengi tutarlılığı, lazy aylık takvim önizlemesi ve tarihsiz görevlerin tamamlandıkları gündeki takvim geçmişi test edildi.
- JSON doğrulaması eksik göreve bağlı sayaç, geçersiz faz süresi, bilinmeyen şema ve imkânsız duraklama zamanı gibi bozuk yedekleri reddeder.
- Native test gerçek JSON dosyasını dışa aktardı; aktif sayaçta içe aktarmayı reddetti; iptalden sonra yedeği geri yükleyip önceki veriler için otomatik kurtarma dosyası oluşturdu. [Native sonuç](native-test-v1.1.0.json).
- İçe aktarılan çalışan sayaç gerçek süreç çıkışı ve yeniden açılış sonrasında doğru kaldı. [Yeniden başlatma sonucu](native-restart-v1.1.0.json).
- Universal DMG yine Intel + Apple Silicon, ad-hoc imzalıdır. GitHub tag iş akışı DMG yanında eşleşen SHA-256 dosyasını da üretir.

## GitHub’dan kurulum doğrulaması

- v1.0.0 tag’i için [GitHub Actions universal yayın işi](https://github.com/mahmut-cskn/odak-macos/actions/runs/37769632697) başarıyla tamamlandı.
- v1.1.0 DMG, local build klasörü yerine public GitHub Release’ten indirildi; SHA-256 dosyasıyla eşleşti ve `hdiutil verify` geçti.
- İndirilen DMG’den `/Applications/Odak.app` kuruldu. Ad-hoc imza doğrulandı, `lipo` Intel + arm64 mimarilerini ve Info.plist `1.1.0` sürümünü gösterdi.
- Kurulu uygulama açıldı; görünür 850×780 ana pencere ve Dock’u gizleyen Accessory politikası doğrulandı. Gerçek kullanıcı SQLite dosyası `integrity_check=ok`; native test verileri bu dosyaya yazılmadı.
- Otomatik başlatma kaydı `/Applications/Odak.app/Contents/MacOS/odak` yolunu kullanır. Kurulum imajları çıkarıldı; uygulama kurulu kopyadan çalışır.

- Eski WKWebView sürümleri için güvenli UUID geri dönüşü ve görev kopyalama testleri geçti. Yerel WebView’da Yeni görev diyaloğu gerçekten açıldı: [UI sonucu](native-ui-v1.1.0.json).
