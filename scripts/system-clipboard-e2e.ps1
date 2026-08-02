[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -in @('Witch Clipboard', 'witch-clipboard')
}
if ($running) {
    $details = ($running | ForEach-Object { "$($_.ProcessName) (PID $($_.Id))" }) -join ', '
    throw "Clipboard E2E refused: stop every Electron/Tauri instance first. Running: $details"
}

$previous = $env:WCC_SYSTEM_CLIPBOARD_E2E
try {
    $env:WCC_SYSTEM_CLIPBOARD_E2E = '1'
    & cargo test --manifest-path (Join-Path $workspace 'src-tauri\Cargo.toml') `
        'tests::windows_system_clipboard_pipeline_round_trip' -- `
        --ignored --exact --test-threads=1
    if ($LASTEXITCODE -ne 0) {
        throw "System clipboard E2E failed with exit code $LASTEXITCODE"
    }
} finally {
    $env:WCC_SYSTEM_CLIPBOARD_E2E = $previous
}
