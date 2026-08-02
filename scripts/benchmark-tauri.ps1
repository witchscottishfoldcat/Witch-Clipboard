[CmdletBinding()]
param(
    [string]$Executable = 'src-tauri\target\x86_64-pc-windows-msvc\release\witch-clipboard.exe',
    [ValidateRange(1, 100)]
    [int]$Iterations = 10,
    [ValidateRange(100, 30000)]
    [int]$TimeoutMs = 5000,
    [ValidateRange(100, 10000)]
    [int]$HiddenReadyMs = 800,
    [switch]$KeepData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = Split-Path -Parent $PSScriptRoot
$resolvedExecutable = [IO.Path]::GetFullPath((Join-Path $workspace $Executable))
if (-not (Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) {
    throw "Tauri executable not found: $resolvedExecutable. Run npm run dist:win first."
}

$outRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'out'))
$dataDir = Join-Path $outRoot ("tauri-benchmark-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
@{
    hotkey = 'Ctrl+Alt+Shift+F12'
    quickPasteModifiers = 'Win+Alt'
    trayOpensMini = $false
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataDir 'settings.json') -Encoding UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WccBenchmarkWindows {
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lparam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lparam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);

    public static IntPtr FindVisibleWindow(uint processId, string expectedTitle) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid != processId || !IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(256);
            GetWindowTextW(hwnd, title, title.Capacity);
            if (title.ToString() != expectedTitle) return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@

function Start-IsolatedTauri([switch]$Hidden) {
    $previousData = $env:WCC_TAURI_DATA_DIR
    $previousAutohide = $env:WCC_NO_AUTOHIDE
    try {
        $env:WCC_TAURI_DATA_DIR = $dataDir
        $env:WCC_NO_AUTOHIDE = '1'
        if ($Hidden) {
            return Start-Process -FilePath $resolvedExecutable -ArgumentList '--hidden' -PassThru
        }
        return Start-Process -FilePath $resolvedExecutable -PassThru
    } finally {
        $env:WCC_TAURI_DATA_DIR = $previousData
        $env:WCC_NO_AUTOHIDE = $previousAutohide
    }
}

function Test-PanelVisible([int]$ProcessId) {
    return [WccBenchmarkWindows]::FindVisibleWindow([uint32]$ProcessId, 'Witch Clipboard') -ne [IntPtr]::Zero
}

function Wait-PanelState([int]$ProcessId, [bool]$Visible, [int]$LimitMs) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.ElapsedMilliseconds -lt $LimitMs) {
        if ((Test-PanelVisible $ProcessId) -eq $Visible) {
            return [double]$timer.Elapsed.TotalMilliseconds
        }
        Start-Sleep -Milliseconds 10
    }
    throw "Timed out waiting for panel visible=$Visible (PID $ProcessId)"
}

function Stop-OwnedProcess([Diagnostics.Process]$Process) {
    if ($null -eq $Process -or $Process.HasExited) { return }
    $actual = Get-Process -Id $Process.Id -ErrorAction SilentlyContinue
    if ($null -eq $actual) { return }
    if ([IO.Path]::GetFullPath($actual.Path) -ne $resolvedExecutable) {
        throw "Refusing to stop PID $($Process.Id): executable path no longer matches"
    }
    & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
    $Process.WaitForExit(5000) | Out-Null
}

function Get-ProcessTreeSample([int]$RootId) {
    $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $ids = [Collections.Generic.HashSet[int]]::new()
    $ids.Add($RootId) | Out-Null
    do {
        $changed = $false
        foreach ($row in $rows) {
            if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) {
                $changed = $true
            }
        }
    } while ($changed)
    $processes = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    [pscustomobject]@{
        ProcessCount = $processes.Count
        WorkingSetMB = [math]::Round((($processes | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 2)
        PrivateMB = [math]::Round((($processes | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB), 2)
    }
}

function Get-Percentile([double[]]$Values, [double]$Percentile) {
    $ordered = @($Values | Sort-Object)
    $index = [math]::Max(0, [math]::Ceiling($ordered.Count * $Percentile) - 1)
    return [math]::Round($ordered[$index], 1)
}

$sendKeys = New-Object -ComObject WScript.Shell
$started = [Collections.Generic.List[Diagnostics.Process]]::new()
try {
    $hiddenProcess = Start-IsolatedTauri -Hidden
    $started.Add($hiddenProcess)
    Start-Sleep -Milliseconds $HiddenReadyMs
    $hiddenMemory = Get-ProcessTreeSample $hiddenProcess.Id
    Stop-OwnedProcess $hiddenProcess

    $cold = [Collections.Generic.List[double]]::new()
    for ($index = 0; $index -lt $Iterations; $index++) {
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $process = Start-IsolatedTauri
        $started.Add($process)
        Wait-PanelState $process.Id $true $TimeoutMs | Out-Null
        $cold.Add($timer.Elapsed.TotalMilliseconds)
        Stop-OwnedProcess $process
    }

    $hotProcess = Start-IsolatedTauri -Hidden
    $started.Add($hotProcess)
    Start-Sleep -Milliseconds $HiddenReadyMs
    $firstTimer = [Diagnostics.Stopwatch]::StartNew()
    $sendKeys.SendKeys('^%+{F12}')
    Wait-PanelState $hotProcess.Id $true $TimeoutMs | Out-Null
    $firstWake = $firstTimer.Elapsed.TotalMilliseconds
    $visibleMemory = Get-ProcessTreeSample $hotProcess.Id

    $warm = [Collections.Generic.List[double]]::new()
    for ($index = 0; $index -lt $Iterations; $index++) {
        $sendKeys.SendKeys('^%+{F12}')
        Wait-PanelState $hotProcess.Id $false $TimeoutMs | Out-Null
        Start-Sleep -Milliseconds 100
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $sendKeys.SendKeys('^%+{F12}')
        Wait-PanelState $hotProcess.Id $true $TimeoutMs | Out-Null
        $warm.Add($timer.Elapsed.TotalMilliseconds)
    }

    [pscustomobject]@{
        Executable = $resolvedExecutable
        Iterations = $Iterations
        ColdStartP50Ms = Get-Percentile $cold.ToArray() 0.50
        ColdStartP95Ms = Get-Percentile $cold.ToArray() 0.95
        FirstLazyWakeMs = [math]::Round($firstWake, 1)
        WarmWakeP50Ms = Get-Percentile $warm.ToArray() 0.50
        WarmWakeP95Ms = Get-Percentile $warm.ToArray() 0.95
        HiddenProcesses = $hiddenMemory.ProcessCount
        HiddenWorkingSetMB = $hiddenMemory.WorkingSetMB
        HiddenPrivateMB = $hiddenMemory.PrivateMB
        VisibleProcesses = $visibleMemory.ProcessCount
        VisibleWorkingSetMB = $visibleMemory.WorkingSetMB
        VisiblePrivateMB = $visibleMemory.PrivateMB
    } | Format-List
} finally {
    foreach ($process in $started) {
        Stop-OwnedProcess $process
    }
    if (-not $KeepData) {
        $resolvedData = [IO.Path]::GetFullPath($dataDir)
        if (-not $resolvedData.StartsWith($outRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove benchmark data outside out/: $resolvedData"
        }
        Remove-Item -LiteralPath $resolvedData -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "Benchmark data kept at $dataDir"
    }
}
