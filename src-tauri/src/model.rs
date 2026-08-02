use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: i64,
    pub kind: String,
    pub text: Option<String>,
    pub html: Option<String>,
    pub preview: String,
    pub hash: String,
    pub thumb: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: usize,
    pub source_app: Option<String>,
    pub auto_kind: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub use_count: u32,
    pub created_at: i64,
    pub last_used_at: i64,
}

#[derive(Default, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub q: Option<String>,
    pub kind: Option<String>,
    pub auto_kind: Option<String>,
    pub tag: Option<String>,
    pub pinned_only: Option<bool>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub items: Vec<ClipItem>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct Stats {
    pub total: usize,
    pub pinned: usize,
    pub images: usize,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct PasteOutcome {
    pub ok: bool,
    pub reason: Option<&'static str>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncItem {
    pub kind: String,
    pub text: Option<String>,
    pub html: Option<String>,
    pub preview: String,
    pub hash: String,
    pub blob_name: Option<String>,
    pub thumb: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: usize,
    pub source_app: Option<String>,
    pub auto_kind: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub use_count: u32,
    pub created_at: i64,
    pub last_used_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTombstone {
    pub hash: String,
    pub deleted_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub hotkey: String,
    pub quick_paste_modifiers: String,
    pub max_items: usize,
    pub max_days: u32,
    pub skip_sensitive: bool,
    pub sensitive_apps: Vec<String>,
    pub hide_after_paste: bool,
    pub tray_opens_mini: bool,
    pub visible_filters: Vec<String>,
    pub auto_launch: bool,
    pub theme: String,
    pub accent: String,
    pub opacity: u8,
    pub skipped_version: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+V".to_string(),
            quick_paste_modifiers: "Ctrl+Alt".to_string(),
            max_items: 2_000,
            max_days: 30,
            skip_sensitive: true,
            sensitive_apps: [
                "keepass",
                "1password",
                "bitwarden",
                "lastpass",
                "enpass",
                "keeweb",
                "dashlane",
                "nordpass",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
            hide_after_paste: true,
            tray_opens_mini: true,
            visible_filters: ["all", "text", "image", "files", "url", "key"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            auto_launch: false,
            theme: "system".to_string(),
            accent: "violet".to_string(),
            opacity: 90,
            skipped_version: None,
        }
    }
}
