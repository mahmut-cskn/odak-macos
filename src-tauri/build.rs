fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/notifications.m")
            .file("native/snapshot.m")
            .flag("-fobjc-arc")
            .compile("odak_notifications");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rerun-if-changed=native/snapshot.m");
        println!("cargo:rerun-if-changed=native/notifications.m");
    }
    tauri_build::build();
}
