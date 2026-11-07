//! Reset of desktop-only app data.
//!
//! The webview keeps its storage files open while the window exists, so a reset is
//! scheduled with a marker file and applied on the next start, before any webview is
//! created. Only the app's own directories (named after the bundle identifier) are
//! touched; agent data, credentials and project files live elsewhere.

use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const MARKER_FILE: &str = ".reset-pending.json";
const PROFILES_DIR: &str = "profiles";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetOptions {
    /// Also delete profiles managed by the desktop (`<app data>/profiles`).
    #[serde(default)]
    pub include_profiles: bool,
}

/// The app's own directories. Mirrors Tauri's defaults (`<base dir>/<identifier>`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppDirs {
    pub data: PathBuf,
    pub local_data: PathBuf,
    pub cache: PathBuf,
}

impl AppDirs {
    pub fn resolve(identifier: &str) -> Option<Self> {
        Some(Self {
            data: dirs::data_dir()?.join(identifier),
            local_data: dirs::data_local_dir()?.join(identifier),
            cache: dirs::cache_dir()?.join(identifier),
        })
    }
}

/// Records a pending reset; it is applied by [`apply_pending`] on the next start.
pub fn schedule(dirs: &AppDirs, options: ResetOptions) -> Result<(), String> {
    fs::create_dir_all(&dirs.data)
        .map_err(|error| format!("Failed to create {}: {error}", dirs.data.display()))?;
    let marker = dirs.data.join(MARKER_FILE);
    let body = serde_json::to_string(&options).map_err(|error| error.to_string())?;
    fs::write(&marker, body)
        .map_err(|error| format!("Failed to write {}: {error}", marker.display()))
}

/// Applies a scheduled reset. Must run before the webview is created.
/// Returns whether a reset was applied.
pub fn apply_pending(dirs: &AppDirs, identifier: &str) -> Result<bool, String> {
    let marker = dirs.data.join(MARKER_FILE);
    let raw = match fs::read_to_string(&marker) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Failed to read {}: {error}", marker.display())),
    };
    let options: ResetOptions = serde_json::from_str(&raw).unwrap_or_default();

    // The marker is removed last, so an interrupted reset runs again on the next start.
    let mut keep = vec![MARKER_FILE];
    if !options.include_profiles {
        keep.push(PROFILES_DIR);
    }
    clear_dir(&dirs.data, identifier, &keep)?;
    if dirs.local_data != dirs.data {
        clear_dir(&dirs.local_data, identifier, &[])?;
    }
    if dirs.cache != dirs.data && dirs.cache != dirs.local_data {
        clear_dir(&dirs.cache, identifier, &[])?;
    }

    fs::remove_file(&marker)
        .map_err(|error| format!("Failed to remove {}: {error}", marker.display()))?;
    Ok(true)
}

/// Deletes the entries of an app directory, except `keep`. Refuses directories that
/// are not named after the app identifier, and never follows symlinks.
fn clear_dir(dir: &Path, identifier: &str, keep: &[&str]) -> Result<(), String> {
    if dir.file_name().and_then(|name| name.to_str()) != Some(identifier) {
        return Err(format!(
            "Refusing to clear {}: not an app data directory.",
            dir.display()
        ));
    }
    let metadata = match fs::symlink_metadata(dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to inspect {}: {error}", dir.display())),
    };
    if !metadata.is_dir() {
        return Err(format!(
            "Refusing to clear {}: not a real directory.",
            dir.display()
        ));
    }

    let entries =
        fs::read_dir(dir).map_err(|error| format!("Failed to read {}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read {}: {error}", dir.display()))?;
        let name = entry.file_name();
        if keep.iter().any(|kept| name.to_str() == Some(*kept)) {
            continue;
        }
        let path = entry.path();
        // `file_type` does not follow symlinks; a symlinked directory is removed as a link.
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
        let result = if file_type.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|error| format!("Failed to delete {}: {error}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "com.querymt.desktop.test";

    fn root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("qmt-app-reset-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        root
    }

    fn dirs_in(root: &Path, shared_local: bool) -> AppDirs {
        let data = root.join("data").join(ID);
        AppDirs {
            local_data: if shared_local {
                data.clone()
            } else {
                root.join("local").join(ID)
            },
            cache: root.join("cache").join(ID),
            data,
        }
    }

    fn seed(dirs: &AppDirs) {
        fs::create_dir_all(dirs.data.join("profiles/user")).unwrap();
        fs::write(dirs.data.join("profiles/user/a.toml"), "x").unwrap();
        fs::create_dir_all(dirs.data.join("localstorage")).unwrap();
        fs::write(dirs.data.join("hsts-storage.sqlite"), "x").unwrap();
        fs::create_dir_all(dirs.local_data.join("WebKitCache")).unwrap();
        fs::create_dir_all(dirs.cache.join("cef")).unwrap();
    }

    #[test]
    fn does_nothing_without_a_marker() {
        let root = root("no-marker");
        let dirs = dirs_in(&root, true);
        seed(&dirs);
        assert_eq!(apply_pending(&dirs, ID), Ok(false));
        assert!(dirs.data.join("localstorage").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn clears_app_data_and_keeps_profiles_by_default() {
        let root = root("keep-profiles");
        let dirs = dirs_in(&root, false);
        seed(&dirs);
        schedule(&dirs, ResetOptions::default()).unwrap();
        assert_eq!(apply_pending(&dirs, ID), Ok(true));
        assert!(dirs.data.join("profiles/user/a.toml").exists());
        assert!(!dirs.data.join("localstorage").exists());
        assert!(!dirs.data.join("hsts-storage.sqlite").exists());
        assert!(!dirs.data.join(MARKER_FILE).exists());
        assert!(!dirs.local_data.join("WebKitCache").exists());
        assert!(!dirs.cache.join("cef").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deletes_profiles_when_requested() {
        let root = root("delete-profiles");
        let dirs = dirs_in(&root, true);
        seed(&dirs);
        schedule(
            &dirs,
            ResetOptions {
                include_profiles: true,
            },
        )
        .unwrap();
        assert_eq!(apply_pending(&dirs, ID), Ok(true));
        assert!(!dirs.data.join("profiles").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_directories_not_named_after_the_app() {
        let root = root("wrong-name");
        fs::create_dir_all(root.join("other")).unwrap();
        assert!(clear_dir(&root.join("other"), ID, &[]).is_err());
        assert!(root.join("other").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn removes_symlinks_without_following_them() {
        let root = root("symlink");
        let dirs = dirs_in(&root, true);
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), "x").unwrap();
        fs::create_dir_all(&dirs.data).unwrap();
        std::os::unix::fs::symlink(&outside, dirs.data.join("link")).unwrap();
        schedule(&dirs, ResetOptions::default()).unwrap();
        assert_eq!(apply_pending(&dirs, ID), Ok(true));
        assert!(!dirs.data.join("link").exists());
        assert!(outside.join("keep.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
