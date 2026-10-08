use std::ffi::CString;
unsafe extern "C" {
    fn odak_request_notification_permission();
    fn odak_send_notification(
        title: *const std::ffi::c_char,
        body: *const std::ffi::c_char,
        sound: bool,
    ) -> i32;
}
pub fn request_permission() {
    unsafe {
        odak_request_notification_permission();
    }
}
pub fn send(title: &str, body: &str, sound: bool) -> Result<(), String> {
    let title = CString::new(title).map_err(|_| "Bildirim başlığı geçersiz.")?;
    let body = CString::new(body).map_err(|_| "Bildirim metni geçersiz.")?;
    let result = unsafe { odak_send_notification(title.as_ptr(), body.as_ptr(), sound) };
    if result == 0 {
        Ok(())
    } else {
        Err("macOS bildirimleri kapalı veya bildirim hizmetine ulaşılamıyor. Sistem Ayarları → Bildirimler → Odak bölümünü kontrol edin.".into())
    }
}
