use std::sync::LazyLock;

use regex::Regex;

macro_rules! lazy {
    ($pattern:expr) => {
        LazyLock::new(|| Regex::new($pattern).expect("static classification regex"))
    };
}

static URL: LazyLock<Regex> = lazy!(r"(?i)^(?:https?://|www\.)\S+$");
static EMAIL: LazyLock<Regex> = lazy!(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$");
static COLOR: LazyLock<Regex> = lazy!(r"(?i)^(?:#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))$");
static PATH: LazyLock<Regex> = lazy!(r"(?i)^(?:[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|/)[^\n]{1,300}$");
static NUMBER: LazyLock<Regex> = lazy!(r"^[-+]?\d[\d\s,._]*$");
static KEY_PREFIX: LazyLock<Regex> = lazy!(
    r"(?i)^(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{10,})$"
);
static JWT: LazyLock<Regex> = lazy!(r"(?i)^eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$");
static NAMED_KEY: LazyLock<Regex> = lazy!(
    r#"(?i)^(?:api[_ -]?key|access[_ -]?key|secret(?:[_ -]?key)?|token|license[_ -]?key)\s*[:=]\s*["']?[a-z0-9_./+=-]{8,}["']?$"#
);
static MODEL: LazyLock<Regex> = lazy!(
    r"(?i)^(?:(?:openai|anthropic|google|meta|deepseek|alibaba|mistral)[/:])?(?:(?:gpt|chatgpt|o[134]|text-embedding)[\w.-]*|claude[\w.-]*|gemini[\w.-]*|deepseek[\w.-]*|qwen[\w.-]*|llama[\w.-]*|mistral[\w.-]*|mixtral[\w.-]*|glm[\w.-]*|moonshot[\w.-]*|kimi[\w.-]*|ernie[\w.-]*|doubao[\w.-]*)$"
);
static NAMED_MODEL: LazyLock<Regex> =
    lazy!(r#"(?i)^(?:model|model[_ -]?name|模型|模型名称)\s*[:=：]\s*["']?[\w./:-]{2,100}["']?$"#);
static PASSWORD: LazyLock<Regex> = lazy!(r"(?i)(?:password|passwd|pwd|密码)\s*[:=：]\s*\S{4,}");
static CODE_END: LazyLock<Regex> = lazy!(r"(?m)[;{}]\s*$");
static CODE_WORD: LazyLock<Regex> = lazy!(
    r"(?m)^\s*(?:import|export|from|const|let|var|function|class|def|fn|package|using|public|private)\b"
);
static CODE_OPERATOR: LazyLock<Regex> = lazy!(r"=>|::|->|</[a-z]");
static CODE_SHELL: LazyLock<Regex> = lazy!(r"(?m)^\s*(?:\$|>|#)\s+\S+");

pub fn classify(text: &str) -> &'static str {
    let value = text.trim();
    if value.is_empty() {
        return "plain";
    }
    let one_line = !value.contains('\n');
    if one_line {
        if URL.is_match(value) {
            return "url";
        }
        if KEY_PREFIX.is_match(value)
            || JWT.is_match(value)
            || NAMED_KEY.is_match(value)
            || license_key(value)
        {
            return "key";
        }
        if MODEL.is_match(value) || NAMED_MODEL.is_match(value) {
            return "model";
        }
        if EMAIL.is_match(value) {
            return "email";
        }
        if COLOR.is_match(value) {
            return "color";
        }
        if PATH.is_match(value) {
            return "path";
        }
        if value.chars().count() <= 32 && NUMBER.is_match(value) {
            return "number";
        }
    }
    let hits = [
        CODE_END.is_match(value),
        CODE_WORD.is_match(value),
        CODE_OPERATOR.is_match(value),
        CODE_SHELL.is_match(value),
    ]
    .into_iter()
    .filter(|hit| *hit)
    .count();
    if hits >= 2 || (hits >= 1 && !one_line && value.lines().count() >= 3) {
        "code"
    } else {
        "plain"
    }
}

pub fn make_preview(text: &str, max: usize) -> String {
    let first = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();
    let flat = first.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = flat.chars();
    let preview: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

pub fn is_sensitive_sync_text(text: &str) -> bool {
    classify(text) == "key"
        || PASSWORD.is_match(text)
        || text.lines().any(|line| classify(line) == "key")
}

fn license_key(value: &str) -> bool {
    let groups = value.split('-').collect::<Vec<_>>();
    groups.len() >= 3
        && groups
            .iter()
            .all(|group| group.len() >= 4 && group.chars().all(|c| c.is_ascii_alphanumeric()))
        && value.chars().any(|c| c.is_ascii_alphabetic())
        && value.chars().any(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_electron_classification_contract() {
        assert_eq!(classify("https://example.com/a?b=1"), "url");
        assert_eq!(classify("sk-proj-1234567890abcdefghijklmnop"), "key");
        assert_eq!(classify("API_KEY=abc123xyz789secret"), "key");
        assert_eq!(classify("ABCD-1234-EFGH-5678"), "key");
        assert_eq!(classify("gpt-4o-mini"), "model");
        assert_eq!(classify("model=claude-3-7-sonnet"), "model");
        assert_eq!(classify("a.b@example.com"), "email");
        assert_eq!(classify("#8b5cf6"), "color");
        assert_eq!(classify(r"D:\ADM\Witch Clipboard\package.json"), "path");
        assert_eq!(classify("1234567890"), "number");
        assert_eq!(
            classify("export const a = 1;\nfunction b() {\n  return a\n}"),
            "code"
        );
        assert_eq!(classify("今天下午三点开会，讨论剪贴板的保留策略"), "plain");
    }

    #[test]
    fn sensitive_sync_checks_whole_payload_and_lines() {
        assert!(is_sensitive_sync_text("password: correct-horse"));
        assert!(is_sensitive_sync_text(
            "header\ngithub_pat_12345678901234567890\nfooter"
        ));
        assert!(!is_sensitive_sync_text("普通会议纪要"));
    }

    #[test]
    fn preview_uses_first_non_empty_line_and_ellipsis() {
        assert_eq!(make_preview("\n  first   line\nsecond", 20), "first line");
        assert_eq!(make_preview("123456", 5), "12345…");
    }
}
