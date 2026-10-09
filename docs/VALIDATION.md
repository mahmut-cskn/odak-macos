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
- v1.1.0’ın son `0d83ea7` kaynak etiketi için [GitHub Actions universal yayın işi](https://github.com/mahmut-cskn/odak-macos/actions/runs/37772023472) başarılı tamamlandı; universal DMG ve eşleşen SHA-256 otomatik yayımlandı.

## v1.2.0 — çalışan kullanıcı sayacını koruyarak geliştirme

- 13 TypeScript domain testi, 18 Rust testi, 11 izole Chromium UI testi ve 4 Python yedekleme testi geçti.
- Görev adı düzenlemesinin bütün sayaç alanlarını ve görevin diğer alanlarını birebir koruduğu Rust ve UI testlerinde doğrulandı.
- Etiket oluşturma/silme yalnızca ayrı seçim listesine yazıyor; görev/oturum/sayaç verileri değişmiyor. Başka bir görevin renk düzenlemesi eski görevleri topluca yeniden renklendirmiyor.
- Yeni görev şartı, mevcut görevsiz sayacın normal bitişi ve eski görevsiz oturumların Tamamlanan bölümünde dönüşüm yapılmadan görünmesi test edildi.
- Yeni çizgi grafik sıfır günleri, yerel bitiş tarihlerini ve günlük artış/azalışı hesaplıyor; mola ve gelecek kayıtlarını saymıyor. Önceki grafikler korunuyor.
- SQLite Online Backup testi, açık WAL yazıcısı varken son kayıtları, bilinmeyen ek görev alanlarını ve çalışan sayaç zaman damgalarını aynen koruyan ZIP/JSON/SQLite kopyalarını doğruluyor; yazıcı sonrasında da çalışıyor.
- Bu Mac’e ayrı günlük Drive LaunchAgent’ı kuruldu. İlk gerçek ZIP Google Drive’a gönderildi; uzak dosya boyutu doğrulandı. Yedekten hemen önce/sonra 38 mevcut görev kaydı ve çalışan `work` sayaç kaydı birebir aynı kaldı. Kullanıcı notları ve token’lar test raporlarına veya GitHub’a yazılmadı.
- Çalışan `/Applications/Odak.app` kapatılmadı, değiştirilmedi veya yeniden başlatılmadı. Kullanıcının gerçek SQLite’ında şema/görev/oturum/sayaç değişikliği yapılmadı. Arayüz testleri mock verileri, Rust testleri bellek SQLite’ını ve Python testleri geçici dizinleri kullanır.
- Yeni DMG yalnızca derlenip doğrulanır ve indirmeye sunulur; çalışan uygulamanın üzerine otomatik kurulmaz.
- Son v1.2.0 universal DMG `hdiutil verify` kontrolünü geçti; `lipo` arm64 + x86_64 gösterdi ve ad-hoc imza `codesign --verify --deep --strict` ile doğrulandı. SHA-256 dosyası pakete eşlik ediyor.
- Drive’daki gerçek ZIP’in MD5 sağlama toplamı yerel kopyayla birebir eşleşti; günlük LaunchAgent ilk çalışmadan `exit code=0` ile çıktı ve 23:55 + 3600 saniyelik tetikleri doğrulandı.
- `cargo clippy --all-targets --locked -- -D warnings` temiz. Toplam 46 otomatik test geçti.

## v1.3.0 — onaylı silme, geçmiş ve öncelik

- 15 TypeScript domain testi, 21 Rust testi, 16 Chromium UI testi ve 4 Python yedekleme testi geçti: toplam 56. `cargo clippy --all-targets --locked -- -D warnings` temiz.
- Tek görev oluşturma yolu ve yalnızca Bugün/Liste’de görünen sayaç doğrulandı. Çalışan sayaç sekme değişimlerinde aynı kalıyor.
- Geçmiş takvimde oluşturma, düzenleme, tamamlama, alt görev değiştirme ve odak başlatma kapalı; geçmiş gün görüntülemek `ensure_day` çağırmıyor. Native komut da geçmişe örnek üretmeden dönüyor. Eski tarih alanları dönüştürülmüyor.
- Görev, alt görev, etiket, seri ve oturum silme/iptal ile JSON içe aktarma onayları test edildi. Vazgeçmek veri değiştirmiyor; Escape alttaki görev düzenleyiciyi kapatmıyor. Native komutlar onaysız silme/iptali reddediyor.
- Yıldızlarda hover, 1–5 seçimi, klavye kullanımı, öncelik sıralaması, seri mirası ve yeniden başlatmada kalıcılık test edildi. Öncelik kaydetmek tüm görev/oturum/sayaç yüklerini birebir koruyor; yalnızca ayrı tercih dosyasını değiştiriyor.
- Tekrarlayan görev rozetleri normal görevlerle aynı `.label-tag` görünümünü kullanıyor. [Öncelik görünümü](screenshot-priority.png) ve [salt okunur geçmiş](screenshot-history.png) izole örneklerle görüntülendi.
- Gerçek macOS bildirimleri, iki ses, global kısayol, SQLite işlemleri ve JSON kurtarma kopyası izole native paketle doğrulandı. [Native sonuç](native-test-v1.3.0.json). Gerçek süreç çıkışı ve yeniden açılış sayacı korudu. [Yeniden başlatma](native-restart-v1.3.0.json).
- Güncellemeden önce 47 görev ve 3 oturum içeren ek Drive ZIP yedeği başarıyla gönderildi. Yardımcı artık varsa yıldız önceliklerini de ZIP’e koyuyor; açık WAL veritabanı testi bu dosyayı doğruluyor.
- Universal DMG CRC kontrolünü geçti; kurulu paket DMG’deki çalıştırılabilirle birebir aynı. `lipo` x86_64 + arm64 gösteriyor ve `codesign --verify --deep --strict` başarılı.
- `/Applications/Odak.app` v1.3.0 kuruldu ve normal kullanıcı verisiyle açıldı. Salt okunur SQLite kontrolü, önce/sonra 47 görevin, 3 oturumun ve idle sayaç kaydının birebir aynı olduğunu doğruladı; `quick_check=ok`. Gerçek görev içerikleri test raporlarına veya GitHub’a yazılmadı.

## v1.3.1 — belirgin iptal butonu

- Yalnızca iptal butonunun görünümü değişti: kırmızı kenarlık, tema uyumlu kırmızı yazı, belirgin hover ve klavye odağı. Çalışan sayaç ve onay akışı değişmedi.
- Mevcut sayaç kontrolü, ad düzenleme sırasında süreyi koruma ve iptal/silme onayı UI testleri geçti: 3 test. Üretim TypeScript/Vite derlemesi başarılı.
- İzole örnek görevlerle açık ve koyu temada kırmızı kenarlık ve yazı doğrulandı; görsel inceleme tamamlandı.
- Universal paket arm64 ve x86_64 içeriyor; ad-hoc imza ve DMG CRC kontrolü başarılı. Çalışan kurulu uygulama kapatılmadan yeni paket hazırlandı; kullanıcı SQLite’ına doğrudan yazılmadı.

## v1.4.0 — görev seçimi ve görev pomodoro süresi

- 17 TypeScript, 26 Rust, 20 Chromium UI ve 4 Python testi geçti: toplam 67. `cargo clippy --all-targets --locked -- -D warnings` temiz.
- Yeni görev ve hızlı eklemede boş, sıfır, 90’dan büyük veya kesirli süreyle görev kaydedilemiyor. 30 dakikalık yeni görev, toplam tahmini 120 dakika ve panel değeri 45 olsa da görevdeki ▶ ile 30 dakikadan başlıyor.
- Görev listesi çalışma ve duraklamada görünür/kilitli; mola sonunda etkinleşiyor. Yeni görev seçilince onun süresi yükleniyor ve Devam et o görevle yeni oturum başlatıyor.
- Çalışan 45 dakikalık görevde pomodoro tercihini 30 yapmak tüm görev/oturum/sayaç alanlarını aynı bırakıyor; sonraki oturum 30 dakikadan başlıyor. Gerçek SQLite birim testi aktif sayaç alanlarını koruyor; veritabanı yazması başarısız olursa süre tercihi geri alınıyor.
- Eski görevler için süre dosyası veya alanı otomatik oluşturulmuyor. Süre dosyasının yeniden açılışta kalıcılığı, tekrar serisinden miras ve günlük örnek önceliği test edildi.
- Yeni JSON süre bilgilerini taşıyor; eski JSON yedekleri okunuyor. Açık WAL veritabanı testi Drive ZIP’ine süre dosyası/JSON metadata dahil edilirken kaynak verilerin korunduğunu doğruluyor. Kurulu günlük yardımcı yeni dosyayı destekleyecek şekilde güncellendi; token ve zamanlama değiştirilmedi.
- [Görev süresi penceresi](screenshot-task-duration.png) ve [30 dakika + görünür görev listesi](screenshot-focus-duration.png) izole örneklerle görsel olarak kontrol edildi.
- Universal DMG hazırlandı; mimari, ad-hoc imza ve CRC doğrulaması geçti. Çalışan kurulu Odak kapatılmadı, yeniden açılmadı veya üzerine kurulmadı; kullanıcının gerçek SQLite’ına doğrudan yazılmadı. Yeni sürüm oturum bitince kurulabilir.

## v1.5.0 — onaylı erken bitirme ve zorunlu etiket

Yerel doğrulama: 9 Ekim 2026.

- 19 TypeScript, 33 Rust, 25 Chromium UI ve 4 Python testi geçti: toplam 81. `cargo clippy --all-targets --locked -- -D warnings` temiz.
- **Bitir** onayından vazgeçmek görev, sayaç ve oturumları değiştirmiyor. Onay, görevi tamamlıyor ve 45 dakikalık oturumda 20 dakika çalışılmışsa grafiğe yalnızca 20 dakika ekliyor. Duraklatılmış oturumda beklenen süre sayılmıyor; tamamlamayı geri almak kaydedilmiş süreyi koruyor.
- Mola iptali görevi aktif bırakıyor; molada Bitir görevi tamamlıyor. İkisi de önceden kaydedilmiş odak süresini koruyor ve mola süresini odak olarak kaydetmiyor.
- Onay açıkken çalışma/mola süresinin dolması çalışma kaydını iki kez üretmiyor. Eski oturuma ait onay yeni oturumu değiştirmeden reddediliyor; bitirme tekrarlandığında ek kayıt oluşmuyor.
- Gerçek SQLite bellek veritabanı ve JSON yedek doğrulaması, erken bitirilen 12,5 dakikalık oturumun, görev notlarının ve tahmin süresinin aynen geri yüklendiğini doğruluyor.
- Normal görev ve hızlı eklemede boş veya yalnızca boşluk içeren etiket kaydedilemiyor; yeni yazılan etiket oluşturulabiliyor. Eski etiketsiz görevler/yedekler kabul ediliyor; toplu veri dönüşümü yapılmıyor. Hızlı eklemenin tüm alanları 480×260 penceresine sığıyor.
- [Bitir düğmesi](screenshot-finish.png), [onay penceresi](screenshot-finish-confirm.png) ve [zorunlu hızlı etiket](screenshot-quick-label.png) izole örneklerle görüntülendi.
- Kullanıcının gerçek SQLite dosyasına doğrudan yazılmadı; kurulu Odak kapatılmadı, yeniden başlatılmadı veya üzerine kurulmadı. UI testleri izole mock verileri, native domain testleri bellek/geçici veritabanlarını kullanır.
- Üretim TypeScript/Vite ve universal Tauri derlemesi başarılı. `lipo` x86_64 + arm64 gösteriyor; `codesign --verify --deep --strict` ve `hdiutil verify` geçti. Salt okunur bağlanan DMG'de `/Applications` kısayolu, Finder yerleşimi ve v1.5.0 uygulaması var; paket içindeki çalıştırılabilirin SHA-256 değeri derlenen kopyayla aynı. SHA-256 dosyası Release'e eklenir.

## v1.6.0 — sıradaki odak ve tekil tekrar seçimi

Yerel doğrulama: 9 Ekim 2026.

- 25 TypeScript, 36 Rust, 29 Chromium UI ve 4 Python testi geçti: toplam 94. `cargo clippy --all-targets --locked -- -D warnings` temiz.
- Bugünün 5 → 4 → 3 yıldızlı görevlerinden sonra genel listedeki 5 yıldızlı görev öneriliyor. Biten oturumun eski seçimi temizleniyor; yeni önerinin kayıtlı pomodoro süresi yükleniyor. Boş gündem/listede görevsiz başlatma kapalı.
- Doğal çalışma bitişinde görev aktif kalırken panel **Mola zamanı** ve sonraki öneriyi gösteriyor. Mola bittikten sonra Devam et önerilen görevle başlıyor. Molanın çalışır ve duraklatılmış durumlarında iptal düğmesi yok; onaylı Bitir önceden kazanılan süreyi değiştirmiyor. Duraklatılmış molada sıradaki görevi seçmek bütün veri alanlarını koruyor; Bitir önceki görevi tamamlıyor ve sıradaki seçimi değiştirmiyor.
- Tekrar serisinde geçmiş örnek eleniyor, en yakın aktif örnek seçiliyor ve daha uzak örnekler gösterilmiyor. Aynı isimli farklı görev/seriler ayrı kalıyor. Aylık tekrarın 29 gün sonraki üretilmemiş örneği, 59 gün sonraki kayıtlı örnekten önce görünüyor; aylık 31 Şubat gibi olmayan günler atlanıyor.
- Tekrar seçmek görev/oturum/sayacı değiştirmiyor. Başlatma sadece seçilen gelecekteki örneği oluşturuyor; diğer örnekler ve seriler korunuyor. Native testler geçmiş/geçersiz/eksik seri seçimlerini yazmadan reddediyor, tamamlanan örneği yeniden üretmiyor ve aynı örneği iki kez oluşturmuyor.
- [Sıradaki iş önerisi](screenshot-focus-suggestion.png) ve [molada öneri](screenshot-break-suggestion.png) izole örneklerle görüntülendi ve görsel olarak kontrol edildi.
- Kullanıcı verisi doğrudan değiştirilmedi, SQLite şeması dönüştürülmedi ve kurulu Odak kapatılmadı veya yeniden başlatılmadı. Gerçek kullanıcı yerine test verileri ve geçici/bellek veritabanları kullanıldı.
- Üretim TypeScript/Vite ve universal Tauri build başarılı. `lipo` x86_64 + arm64, Info.plist v1.6.0 gösteriyor; ad-hoc imza ve DMG CRC kontrolleri geçti. Salt okunur bağlanan pakette Applications kısayolu ve Finder yerleşimi var; paket çalıştırılabilirinin SHA-256 değeri derlenen uygulamayla aynı. DMG'ye eşleşen SHA-256 dosyası hazırlandı.

## v1.7.0 — panelde alt görevler ve salt okunur tamamlanan kartları

Yerel doğrulama: 9 Ekim 2026.

- 28 TypeScript, 39 Rust, 34 Chromium UI ve 4 Python testi geçti: toplam 105. `cargo clippy --all-targets --locked -- -D warnings` temiz.
- Bugün kartının boş alanı ve Liste kartında Enter, görevi/süresini seçiyor; görev, oturum ve sayaç verileri aynı kalıyor. Çalışan veya duraklatılmış çalışma sırasında başka karta basmak mevcut görevi ve süreyi değiştirmiyor. Alt kontroller kendi işlevini koruyor.
- Pomodoro panelindeki checklist'in işaretlenmesi sadece hedef alt görevin `done` alanını değiştiriyor. Gerçek native domain testleri çalışan ve duraklatılmış sayaçların tüm alanlarını birebir koruyor; bütün alt görevler bitince ana görev aktif kalıyor. Tamamlanan veya eksik görevin checklist değişikliği yazmadan reddediliyor.
- Tamamlanan görevler en yeni önce gösteriliyor. Kartta etiket, salt okunur yıldızlar, gerçek/planlanan süre, iş tahmini ve oturum sayısı var. Detay açmak hiçbir yazma komutu göndermiyor; not ve checklist okunuyor, düzenlenebilir alan/menü yok. Girilmemiş plan gün/başlangıç/bitiş/son zaman alanları gizleniyor; kayıt varsa gösteriliyor. Önceki tamamlama geri alma yuvarlağı korunuyor; geçmiş takvimde devre dışı.
- Mola sonrasında 30 dakikalık görevi seçmek paneli 30:00'a, 45 dakikalık diğer görevi seçmek 45:00'a getiriyor; yalnızca seçim yapmak veri değiştirmiyor.
- Gerçek Rust zamanlayıcı testi 1 saniyelik erken bitirmeyi tek work oturumu ve `actualMin=1/60` olarak kaydediyor. UI'da Toplam oturum 1, odak 1sn görünüyor. Doğrudan görev tiklemek ise oturum/süre eklemiyor.
- [Panel checklist](screenshot-focus-checklist.png), [koyu checklist](screenshot-focus-checklist-dark.png), [tamamlanan kartları](screenshot-completed-cards.png), [salt okunur detay](screenshot-completed-details.png) ve [koyu detay](screenshot-completed-details-dark.png) izole örneklerle görüntülendi ve kontrol edildi.
- Görev/oturum/sayaç/ayar şemaları değiştirilmedi, geçmiş dönüştürülmedi ve kullanıcının SQLite dosyasına doğrudan yazılmadı. Kurulu uygulama kapatılmadı, yeniden başlatılmadı veya üzerine kurulmadı.
- Üretim TypeScript/Vite ve universal Tauri derlemesi başarılı. `lipo` x86_64 + arm64, Info.plist v1.7.0 gösteriyor; `codesign --verify --deep --strict` ve DMG CRC doğrulaması geçti. Salt okunur bağlanan paketin Applications kısayolu, Finder yerleşimi ve derlenen uygulamayla eşleşen çalıştırılabilir SHA-256 değeri kontrol edildi; DMG SHA-256 dosyası hazırlandı.
