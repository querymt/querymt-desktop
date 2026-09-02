fn main() {
    #[cfg(all(feature = "cef", target_os = "linux"))]
    {
        tauri_runtime_cef::configure(tauri_runtime_cef::CefConfig {
            identifier: "com.querymt.desktop".into(),
            custom_schemes: vec!["tauri".into(), "ipc".into(), "asset".into()],
            command_line_args: cef_command_line_args(),
            linux_windowing: tauri_runtime_cef::LinuxWindowing::X11,
            ..Default::default()
        });

        if std::env::args().any(|arg| arg.starts_with("--type=")) {
            tauri_runtime_cef::run_cef_helper_process();
            return;
        }

        tauri_runtime_cef::set_permission_policy(|request, responder| {
            if request.webview_label == "main"
                && request
                    .origin
                    .as_ref()
                    .is_some_and(|origin| origin.is_app_local())
                && !request.kinds.is_empty()
                && request
                    .kinds
                    .iter()
                    .all(|kind| matches!(kind, tauri_runtime_cef::PermissionKind::ClipboardRead))
            {
                return responder.allow();
            }
            responder.deny(tauri_runtime_cef::DenyReason::NoPolicy)
        });

        // The stable runtime uses CEF's X11 backend, including under Wayland via XWayland.
        unsafe {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

    querymt_desktop_lib::run();
}

#[cfg(all(feature = "cef", target_os = "linux"))]
fn cef_command_line_args() -> Vec<(String, Option<String>)> {
    let mut args = Vec::new();

    if let Ok(port) = std::env::var("QUERYMT_CEF_DEVTOOLS") {
        args.push(("--remote-debugging-port".into(), Some(port)));
    }
    if std::env::var_os("QUERYMT_CEF_DISABLE_GPU").is_some() {
        args.push(("--disable-gpu".into(), None));
    }
    if let Ok(extra) = std::env::var("QUERYMT_CEF_ARGS") {
        for arg in extra
            .split(',')
            .map(str::trim)
            .filter(|arg| !arg.is_empty())
        {
            match arg.split_once('=') {
                Some((key, value)) => args.push((key.to_owned(), Some(value.to_owned()))),
                None => args.push((
                    if arg.starts_with('-') {
                        arg.to_owned()
                    } else {
                        format!("--{arg}")
                    },
                    None,
                )),
            }
        }
    }

    args
}
