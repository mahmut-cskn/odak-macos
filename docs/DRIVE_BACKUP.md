# Günlük Google Drive yedeği

Bu özellik Odak uygulamasının dışında, bu Mac’te çalışan ayrı bir yardımcıdır. Odak hesabı veya ağ isteği eklenmez. Yalnızca yardımcının ZIP yedeği Google Drive’a gönderilir.

## Bu Mac’teki düzen

- Çalışma zamanı: her gün 23:55; saatlik kontrol ve girişte kontrol, uyku veya bağlantı kesintisinde eksik günlük yedeği tamamlar. Başarılı bir günlük yedek aynı gün tekrar gönderilmez.
- Drive hedefi: bu yardımcıya ait **Odak** klasörü. Obsidian yedekleri değiştirilmez.
- Yerel kopyalar, durum ve ayrı yenilenen Drive izni: `~/Library/Application Support/Odak Backup/`.
- LaunchAgent: `~/Library/LaunchAgents/com.mahmutcskn.odak-backup.plist`.
- ZIP içerikleri: `odak.sqlite3`, `odak-yedek.json`, varsa `labels.json`, `priorities.json` ve `task-durations.json`, geri yükleme açıklaması. Görev pomodoro süreleri JSON yedeğinde de bulunur.
- Kaynak SQLite salt okunur açılır; Online Backup API, WAL’daki son kayıtları da tutarlı kopyaya dahil eder. Çalışan uygulama, sayaç ve görevler değişmez. Eski yedekler silinmez.
- İnternet hatasında yerel ZIP korunur; başarı kaydı yazılmaz ve sonraki kontrol yeniden dener.
- Python ortamı mevcut Obsidian yedekleme projesinden kullanılır. Bu projenin klasörünü/ortamını taşırsan yardımcının kurulumunu yeni yol ile tekrarla.

## Başka bir Mac’e kurulum

Son kullanıcı için Odak’ın çalışması bu yardımcıya bağlı değildir. Günlük Drive yedeği isteyen ve Obsidian projesinde zaten Drive’a giriş yapmış kullanıcı, kaynak depoda:

```sh
python3 scripts/install_drive_backup.py \
  --obsidian-project "$HOME/Projects/obsidian-backup"
```

Farklı SQLite konumu varsa `--database /tam/yol/odak.sqlite3` eklenebilir. Yardımcı yeni giriş açmaz; mevcut `drive.file` iznini kullanır. OAuth dosyaları, token’lar ve yedekler GitHub’a konmaz.

Anında ek yedek:

```sh
"$HOME/Projects/obsidian-backup/venv/bin/python" \
  "$HOME/Library/Application Support/Odak Backup/drive_backup.py" --manual
```

Yalnızca yerel kopya oluşturmak için aynı komuta `--local-only` ekle; bu Google Drive’a göndermez.

## Geri yükleme

Drive’daki Odak klasöründen istediğin ZIP’i indir ve aç. Odak’ın sayacı çalışmıyorken **Ayarlar → JSON içe aktar** ile onay verip `odak-yedek.json` seç. Mevcut verilerin yerini değiştirmeden önce Odak otomatik kurtarma JSON’u oluşturur. v1.4.0 görev pomodoro sürelerini JSON’dan geri yükler; eski JSON’larda süre alanı yoksa mevcut tercihler korunur. Etiket seçim listesi ayrı `labels.json`, yıldız öncelikleri `priorities.json` içindedir; bu tercih dosyalarını uygulama kapalıyken app-data klasörüne koyabilirsin. SQLite ile geri yüklemede `task-durations.json` da süre tercihlerini taşır. Alternatif SQLite dosyasını çalışan uygulamanın üzerine kopyalama.

## Kontrol ve durdurma

```sh
launchctl print "gui/$(id -u)/com.mahmutcskn.odak-backup"
```

Son başarı `Odak Backup/state.json`, hatalar `backup-error.log` içindedir. v1.2.0 Ayarlar’da ayrıca son başarılı Drive yedeği tarihi görünür.

Günlük yardımcıyı durdurmak için:

```sh
launchctl bootout "gui/$(id -u)/com.mahmutcskn.odak-backup"
launchctl disable "gui/$(id -u)/com.mahmutcskn.odak-backup"
```

Bu komutlar Odak’ın otomatik başlatmasını ve çalışan sayacını etkilemez.

Teknik dayanaklar: [SQLite Online Backup API](https://www.sqlite.org/c3ref/backup_finish.html), [Google Drive dosya yükleme](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create).
