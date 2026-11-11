/// Build script entry: forwards release metadata and runs the Tauri build.
fn main() {
    if std::env::var_os("CARGO_FEATURE_CEF").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
    {
        // CEF libraries are copied beside the executable by cef-dll-sys.
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    }

    forward_release_metadata();

    tauri_build::build()
}

/// Forwards the release channel and the bundled qmtcode version to the crate as
/// compile-time constants (`QMT_RELEASE_CHANNEL`, `QMTCODE_VERSION`).
///
/// The updater uses them to pick its default feed and to refuse updates that
/// would downgrade qmtcode. CI sets `QMT_RELEASE_CHANNEL` for every published
/// build, so a release-profile build with a channel but no qmtcode version
/// fails here instead of shipping a build that silently skips the gate.
/// Development builds set neither and skip the gate.
fn forward_release_metadata() {
    println!("cargo:rerun-if-env-changed=QMT_RELEASE_CHANNEL");
    println!("cargo:rerun-if-env-changed=QMTCODE_VERSION");

    let channel = std::env::var("QMT_RELEASE_CHANNEL")
        .ok()
        .filter(|v| !v.is_empty());
    let qmtcode = std::env::var("QMTCODE_VERSION")
        .ok()
        .filter(|v| !v.is_empty());

    if let Some(channel) = &channel {
        if channel != "stable" && channel != "nightly" {
            panic!("QMT_RELEASE_CHANNEL must be `stable` or `nightly`, got `{channel}`");
        }
    }
    if channel.is_some()
        && qmtcode.is_none()
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        panic!(
            "QMT_RELEASE_CHANNEL is set but QMTCODE_VERSION is not: a release build must know \
             which qmtcode it bundles so updates cannot downgrade it"
        );
    }
    if let Some(version) = &qmtcode {
        // Accept `v1.2.3` as published tags, embed plain semver.
        println!(
            "cargo:rustc-env=QMTCODE_VERSION={}",
            version.strip_prefix('v').unwrap_or(version)
        );
    }
    println!(
        "cargo:rustc-env=QMT_RELEASE_CHANNEL={}",
        channel.as_deref().unwrap_or("stable")
    );
}
