# Aiven MySQL bağlantısı

Odak verilerinin asıl çalışma kopyası bu Mac'teki SQLite dosyasıdır. Aiven MySQL,
verileri DBeaver gibi bağımsız bir araçta incelemek ve yeni bir Mac'e doğrulanmış
JSON yedeği indirmek için kullanılan özel bulut aynasıdır. Odak uygulaması çevrimdışı
çalışmaya devam eder; MySQL parolası uygulamaya veya GitHub deposuna yazılmaz.

## Bu Mac'teki hazır bağlantı

DBeaver Community içinde **odak** bağlantısı kuruludur. Bağlantı TLS ile doğrulanır,
parola DBeaver'da saklanmaz ve profil salt okunurdur. **Connections → odak →
Databases → odak → Tables → odak_tasks → Data** yolu gerçek görev satırlarını açar.
Oturumlar `odak_sessions`, etiketler `odak_labels`, uygulama durumu `odak_meta`,
senkronizasyon özeti `odak_sync_state`, geri yüklenebilir geçmiş kopyalar ise
`odak_backup_snapshots` tablosundadır.

Canlı yerel veriyi yeni bir bulut anlık görüntüsü olarak göndermek için:

```sh
python3 scripts/mysql_sync.py --apply
```

Kaynak SQLite salt okunur ve tutarlı bir işlem içinde açılır. Uzak tablolar tek MySQL
işlemi içinde yenilenir; işlem başarısız olursa önceki bulut durumu korunur. Her
başarılı yükleme ayrıca `odak_backup_snapshots` içinde yeni ve değiştirilemez bir
anlık görüntü bırakır. Çalışan sayaç kapatılmaz veya değiştirilmez.

## Yeni bir Mac'te bağlanma

1. GitHub'dan Odak deposunu indir veya klonla. `scripts/aiven-ca.pem` yalnızca açık
   TLS sertifikasıdır; parola içermez.
2. MySQL istemcisini kur: `brew install mysql-client`. Görsel inceleme için ayrıca
   DBeaver Community kurulabilir.
3. [Aiven Console](https://console.aiven.io/) içinde **odak → odak-mysql → Users →
   odak_app** yolundan parolayı kopyala. Parolayı GitHub'a, bir not dosyasına veya
   ekran görüntüsüne koyma.
4. Depo klasöründe `python3 scripts/mysql_setup.py` çalıştır. İstendiğinde parolayı
   gir. Araç önce TLS bağlantısını ve hesabı doğrular, sonra parolayı o Mac'in
   Anahtar Zinciri'ne `com.mahmutcskn.odak.mysql` adıyla kaydeder ve CA dosyasını
   Odak app-data klasörüne kopyalar.
5. DBeaver'da yeni MySQL bağlantısı oluştur:

   | Alan | Değer |
   | --- | --- |
   | Host | `odak-mysql-odak.c.aivencloud.com` |
   | Port | `14664` |
   | Database | `odak` |
   | Username | `odak_app` |
   | SSL CA certificate | Depodaki `scripts/aiven-ca.pem` |

   **Require SSL** ve **Verify server certificate** açık olsun. Parolayı bağlantı
   anında gir; **Save password** seçeneğini kapalı bırak. Yalnızca inceleme yapılacaksa
   bağlantıyı **Read-only** yap.

6. Buluttaki son doğrulanmış veriyi yeni Mac'e indir:

   ```sh
   python3 scripts/mysql_restore.py
   ```

   Dosya `~/Downloads/odak-bulut-yedek.json` olarak, yalnızca kullanıcı tarafından
   okunabilen izinlerle yazılır. Araç SHA-256 bütünlük özetini doğrulamadan dosya
   üretmez ve var olan bir dosyanın üzerine `--force` verilmeden yazmaz.
7. Odak uygulamasında **Ayarlar → JSON içe aktar** ile bu dosyayı seç. Uygulama,
   mevcut veriyi değiştirmeden önce kendi kurtarma kopyasını alır. Aktarım sırasında
   sayaç boşta olmalıdır.

Bu düzen tek bir yerel çalışma kopyası ve bulut yedeği içindir. İki Mac'te aynı anda
değişiklik yapıp çift yönlü birleştirme yapmaz. Bilgisayar değiştirirken eski Mac'te
son kez `mysql_sync.py --apply` çalıştır, yeni Mac'te `mysql_restore.py` ile indir,
sonra yeni Mac'i çalışma kopyası olarak kullan.

## Güvenlik ve iptal

- GitHub'da parola, erişim anahtarı veya kişisel veri yoktur.
- MySQL bağlantısı sunucu sertifikasını proje CA'sıyla doğrular.
- `odak_app` yalnızca `odak` veritabanında gerekli tablo yetkilerine sahiptir.
- Erişimi iptal etmek veya parolayı döndürmek için Aiven Console'da kullanıcı
  parolasını yenile; ardından her Mac'te `mysql_setup.py` komutunu yeniden çalıştır.

