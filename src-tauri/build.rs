fn main() {
    if std::env::var_os("CARGO_FEATURE_CEF").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
    {
        // CEF libraries are copied beside the executable by cef-dll-sys.
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    }

    tauri_build::build()
}
