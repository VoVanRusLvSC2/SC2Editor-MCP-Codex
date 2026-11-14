param([uint32]$EditorPid = 0, [switch]$ValidateOnly)

$ErrorActionPreference = 'Stop'

function Get-ModuleHash([string]$File) {
    # .NET works in Windows PowerShell even when the parent app supplies a
    # PowerShell 7 module path that hides the Get-FileHash cmdlet.
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Test-AiModule([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw 'AI Button module is missing. Build/install the AI Button module first.'
    }
    if ((Get-Item -LiteralPath $Root).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'AI Button module directory must not be a link.'
    }
    $manifestPath = Join-Path $Root 'module.json'
    $info = Get-Item -LiteralPath $manifestPath
    if ($info.Length -gt 65536 -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Invalid AI Button module manifest.'
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $expected = @('SC2AIButton.dll', 'SC2AILoader.exe', 'LICENSE', 'README.md', 'README.ru.md',
        'Setup Claude.cmd', 'Login Claude.cmd', 'bridge/main.mjs', 'bridge/chat_titles.mjs',
        'bridge/file_changes.mjs', 'bridge/workspace_snapshot.mjs', 'bridge/locales.json',
        'bridge/mcp_spawn.mjs', 'bridge/mcp_refresh.mjs', 'bridge/package.json', 'bridge/package-lock.json')
    $names = @($manifest.files.PSObject.Properties.Name)
    if ($manifest.schemaVersion -ne 1 -or $manifest.id -cne 'editor-ai-button' -or
        $manifest.loader -cne 'SC2AILoader.exe' -or $manifest.revision -cnotmatch '^[a-f0-9]{40}$' -or
        $manifest.editorExecutable -cne 'SC2Editor_x64.exe' -or
        $manifest.editorVersion -cne '5.0.17.98310' -or
        (($expected | Sort-Object) -join "`n") -cne (($names | Sort-Object) -join "`n")) {
        throw 'Invalid AI Button module manifest.'
    }
    [long]$total = 0
    foreach ($name in $expected) {
        $file = $Root
        foreach ($part in $name.Split('/')) {
            $file = Join-Path $file $part
            if ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "AI Button module links are unsupported: $name"
            }
        }
        $entry = Get-Item -LiteralPath $file
        $total += $entry.Length
        if ($entry.PSIsContainer -or $total -gt 32MB -or
            (Get-ModuleHash $file) -cne $manifest.files.$name) {
            throw "AI Button module verification failed: $name"
        }
    }
    return $manifest
}

try {
    $moduleRoot = Join-Path $PSScriptRoot 'modules\ai-button'
    $manifest = Test-AiModule $moduleRoot
    if ($ValidateOnly) {
        @{ valid = $true; module = $manifest.id; revision = $manifest.revision; editorAttached = $false } |
            ConvertTo-Json -Compress
        exit 0
    }
    Add-Type -AssemblyName System.Windows.Forms
    # The extension starts Node from inside the already-running Editor. Its
    # upstream runtime currently requires an installed Node, not our host PATH.
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($node) { $node.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
        throw 'AI Button needs an installed Node.js 18.14+ and a signed-in Codex or configured Claude provider.'
    }
    $nodeVersion = [version]((& $nodePath -p 'process.versions.node').Trim())
    if ($nodeVersion -lt [version]'18.14.0') { throw 'AI Button requires Node.js 18.14 or newer.' }
    $editors = @(Get-Process -Name SC2Editor_x64 -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 })
    if ($EditorPid) {
        $editors = @($editors | Where-Object { $_.Id -eq $EditorPid })
        if ($editors.Count -ne 1) { throw 'The specified visible Editor process is not available.' }
    }
    if ($editors.Count -eq 0) { throw 'Start StarCraft II Editor x64 and open your map, then run this EXE again.' }
    if ($editors.Count -gt 1) {
        $form = New-Object System.Windows.Forms.Form
        $form.Text = 'SC2EditorToolkit - choose Editor'
        $form.ClientSize = New-Object System.Drawing.Size(650, 125)
        $form.StartPosition = 'CenterScreen'
        $list = New-Object System.Windows.Forms.ComboBox
        $list.SetBounds(15, 15, 620, 28)
        $list.DropDownStyle = 'DropDownList'
        foreach ($editor in $editors) { [void]$list.Items.Add("PID $($editor.Id) - $($editor.MainWindowTitle)") }
        $button = New-Object System.Windows.Forms.Button
        $button.Text = 'Connect AI module'
        $button.SetBounds(425, 65, 210, 35)
        $button.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Controls.AddRange(@($list, $button))
        $form.AcceptButton = $button
        $answer = $form.ShowDialog()
        $selected = $list.SelectedIndex
        $form.Dispose()
        if ($answer -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
        if ($selected -lt 0) { throw 'No Editor was selected; nothing was attached.' }
        $EditorPid = $editors[$selected].Id
    } else { $EditorPid = $editors[0].Id }
    # Reuse the upstream version/toolbar checks and DLL loader. No map save,
    # process restart, global configuration write or automatic attach retry.
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $moduleRoot $manifest.loader
    $start.Arguments = "--pid $EditorPid"
    $start.WorkingDirectory = $moduleRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $loader = [System.Diagnostics.Process]::Start($start)
    $output = $loader.StandardOutput.ReadToEndAsync()
    $errors = $loader.StandardError.ReadToEndAsync()
    if (-not $loader.WaitForExit(150000)) {
        throw 'AI loader timed out. Its result is unknown; inspect the same Editor before retrying.'
    }
    $stdout = $output.GetAwaiter().GetResult()
    $stderr = $errors.GetAwaiter().GetResult()
    $code = $loader.ExitCode
    $loader.Dispose()
    if ($code -ne 0 -or $stdout -notmatch "AI button attached to Editor PID $EditorPid\.") {
        throw "AI module attachment was not confirmed (code $code). $stderr $stdout"
    }
    [System.Windows.Forms.MessageBox]::Show(
        "AI Button connected to Editor PID $EditorPid. Click AI on its toolbar.`nThe module reuses your configured sc2editor MCP.",
        'SC2EditorToolkit') | Out-Null
} catch {
    if ($ValidateOnly) { Write-Error $_.Exception.Message; exit 1 }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'SC2EditorToolkit', 'OK', 'Error') | Out-Null
    exit 1
}
