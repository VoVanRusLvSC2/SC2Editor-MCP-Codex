$ErrorActionPreference='Stop'
$reportRoot=Join-Path (Get-Location).Path 'generated\authoring-acceptance-20260929'
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
$steps=@()
npm.cmd test 2>&1 | Tee-Object -FilePath (Join-Path $reportRoot 'npm-test.log') | Out-Null
$steps+=@{command='npm.cmd test';exitCode=$LASTEXITCODE;log='npm-test.log'}
if($LASTEXITCODE -ne 0){throw 'npm test failed'}
npm.cmd run lint 2>&1 | Tee-Object -FilePath (Join-Path $reportRoot 'lint.log') | Out-Null
$steps+=@{command='npm.cmd run lint';exitCode=$LASTEXITCODE;log='lint.log'}
if($LASTEXITCODE -ne 0){throw 'lint failed'}
npm.cmd run build:release 2>&1 | Tee-Object -FilePath (Join-Path $reportRoot 'release-build.log') | Out-Null
$steps+=@{command='npm.cmd run build:release';exitCode=$LASTEXITCODE;log='release-build.log'}
if($LASTEXITCODE -ne 0){throw 'release build failed'}
node scripts/smoke-project-portable.mjs release/SC2-MCP-Authoring-20260929-r3/app 2>&1 | Tee-Object -FilePath (Join-Path $reportRoot 'portable-smoke.log') | Out-Null
$steps+=@{command='node scripts/smoke-project-portable.mjs release/SC2-MCP-Authoring-20260929-r3/app';exitCode=$LASTEXITCODE;log='portable-smoke.log'}
if($LASTEXITCODE -ne 0){throw 'portable smoke failed'}
$testLog=Get-Content -LiteralPath (Join-Path $reportRoot 'npm-test.log') -Raw
$counts=@{}
foreach($name in @('tests','pass','fail','skipped')){
  $match=[regex]::Match($testLog,"(?m)^\s*[^\r\n]*\b$name\s+(\d+)\s*$")
  if(-not $match.Success){throw "Test summary missing: $name"}
  $counts[$name]=[int]$match.Groups[1].Value
}
$hashes=@{}
foreach($file in @('generated/data-xsd-index/manifest.json','generated/trigger-authoring-registry.json','generated/galaxy-native-api.json','generated/authoring-scenarios-20260929-r2/REPORT.json','generated/project-portable-smoke.json','release/SC2-MCP-Authoring-20260929-r3/BUILD-INFO.json')){
  $hashes[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}
$report=@{
  date='2026-09-29'
  steps=$steps
  testSummary=@{total=$counts.tests;passed=$counts.pass;failed=$counts.fail;skipped=$counts.skipped}
  portable='release/SC2-MCP-Authoring-20260929-r3'
  tools=187
  compiler='NOT_RUN'
  editor='NOT_RUN'
  runtime='NOT_RUN'
  hashes=$hashes
}
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportRoot 'verification.json') -Encoding utf8
Write-Output ($report | ConvertTo-Json -Depth 10)
