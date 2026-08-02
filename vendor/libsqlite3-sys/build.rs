use std::{env, fs, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let sqlite = manifest.join("../../node_modules/better-sqlite3-multiple-ciphers/deps/sqlite3/sqlite3.c");
    let binding = manifest.join("src/bindgen.rs");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("build output"));
    fs::copy(&binding, out.join("bindgen.rs")).expect("copy pregenerated SQLite bindings");

    let mut build = cc::Build::new();
    build
        .file(&sqlite)
        .warnings(false)
        .opt_level(3)
        .define("NDEBUG", None)
        .define("HAVE_INT16_T", "1")
        .define("HAVE_INT32_T", "1")
        .define("HAVE_INT8_T", "1")
        .define("HAVE_STDINT_H", "1")
        .define("HAVE_UINT16_T", "1")
        .define("HAVE_UINT32_T", "1")
        .define("HAVE_UINT8_T", "1")
        .define("HAVE_USLEEP", "1")
        .define("SQLITE_DEFAULT_CACHE_SIZE", "-16000")
        .define("SQLITE_DEFAULT_FOREIGN_KEYS", "1")
        .define("SQLITE_DEFAULT_MEMSTATUS", "0")
        .define("SQLITE_DEFAULT_WAL_SYNCHRONOUS", "1")
        .define("SQLITE_DQS", "0")
        .define("SQLITE_ENABLE_COLUMN_METADATA", None)
        .define("SQLITE_ENABLE_DBSTAT_VTAB", None)
        .define("SQLITE_ENABLE_DESERIALIZE", None)
        .define("SQLITE_ENABLE_FTS3", None)
        .define("SQLITE_ENABLE_FTS3_PARENTHESIS", None)
        .define("SQLITE_ENABLE_FTS4", None)
        .define("SQLITE_ENABLE_FTS5", None)
        .define("SQLITE_ENABLE_GEOPOLY", None)
        .define("SQLITE_ENABLE_JSON1", None)
        .define("SQLITE_ENABLE_MATH_FUNCTIONS", None)
        .define("SQLITE_ENABLE_PERCENTILE", None)
        .define("SQLITE_ENABLE_RTREE", None)
        .define("SQLITE_ENABLE_STAT4", None)
        .define("SQLITE_ENABLE_UPDATE_DELETE_LIMIT", None)
        .define("SQLITE_LIKE_DOESNT_MATCH_BLOBS", None)
        .define("SQLITE_OMIT_DEPRECATED", None)
        .define("SQLITE_OMIT_PROGRESS_CALLBACK", None)
        .define("SQLITE_OMIT_SHARED_CACHE", None)
        .define("SQLITE_OMIT_TCL_VARIABLE", None)
        .define("SQLITE_SOUNDEX", None)
        .define("SQLITE_THREADSAFE", "2")
        .define("SQLITE_TRACE_SIZE_LIMIT", "32")
        .define("SQLITE_USER_AUTHENTICATION", "0")
        .define("SQLITE_USE_URI", "0")
        .compile("sqlite3");

    println!("cargo:include={}", sqlite.parent().expect("SQLite directory").display());
    println!("cargo:rerun-if-changed={}", sqlite.display());
    println!("cargo:rerun-if-changed={}", binding.display());
}
