$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

function Show-Error([string]$Message) {
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        "SC2 UI Workbench",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

try {
    $launcherRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $appRoot = Join-Path $launcherRoot "app"
    $mainScript = Join-Path $appRoot "dist\gui\main.js"
    if (-not (Test-Path -LiteralPath $mainScript -PathType Leaf)) {
        throw "Application files are missing: $mainScript"
    }

    $bundledNode = Join-Path $launcherRoot "runtime\node.exe"
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        $node = $bundledNode
    } else {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) {
            $commonNode = Join-Path $env:ProgramFiles "nodejs\node.exe"
            if (Test-Path -LiteralPath $commonNode -PathType Leaf) {
                $node = $commonNode
            } else {
                throw "Node.js 20+ was not found. Install Node.js 20+ or rebuild the self-contained package with npm run windows:portable on Windows."
            }
        } else {
            $node = $nodeCommand.Source
        }
    }

    $major = [int](& $node -p "Number(process.versions.node.split('.')[0])")
    if ($major -lt 20) {
        throw "Node.js 20+ is required; found version $major at $node"
    }

    $settingsDirectory = Join-Path $env:APPDATA "SC2UIWorkbench"
    $settingsFile = Join-Path $settingsDirectory "settings.txt"
    $initialDirectory = [Environment]::GetFolderPath("MyDocuments")
    if (Test-Path -LiteralPath $settingsFile -PathType Leaf) {
        $savedDirectory = (Get-Content -LiteralPath $settingsFile -Raw).Trim()
        if (Test-Path -LiteralPath $savedDirectory -PathType Container) {
            $initialDirectory = $savedDirectory
        }
    }

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Choose an unpacked/component SC2Map or SC2Mod directory"
    $dialog.SelectedPath = $initialDirectory
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        exit 0
    }
    $workspace = $dialog.SelectedPath
    New-Item -ItemType Directory -Force -Path $settingsDirectory | Out-Null
    Set-Content -LiteralPath $settingsFile -Value $workspace -Encoding UTF8

    $env:SC2_UI_ROOT = $workspace
    $env:SC2_UI_GUI_HOST = "127.0.0.1"
    $env:SC2_UI_GUI_PORT = "4312"
    $nodeArguments = "`"$mainScript`""
    $process = Start-Process -FilePath $node -ArgumentList $nodeArguments -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 900
    if ($process.HasExited) {
        throw "GUI process exited immediately with code $($process.ExitCode). Port 4312 may already be occupied."
    }

    Start-Process "http://127.0.0.1:4312" | Out-Null
    [System.Windows.Forms.MessageBox]::Show(
        "SC2 UI Workbench is running at http://127.0.0.1:4312`n`nWorkspace:`n$workspace`n`nSave changes in the browser. Click OK here when you want to stop the local server.",
        "SC2 UI Workbench",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id
        $process.WaitForExit()
    }
} catch {
    Show-Error $_.Exception.Message
    exit 1
}
