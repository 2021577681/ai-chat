param(
  [string]$Version = 'v0.1.0',
  [string]$Platform = 'windows',
  [switch]$FullE2E,
  [switch]$SkipQuality,
  [switch]$Force,
  [switch]$KeepStage
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Write-Section {
  param([string]$Title)
  Write-Host ''
  Write-Host "==> $Title" -ForegroundColor Cyan
}

function Fail {
  param([string]$Message)
  throw $Message
}

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail ("Command failed ({0}): {1} {2}" -f $LASTEXITCODE, $FilePath, ($Arguments -join ' '))
  }
}

function Assert-SafeReleasePath {
  param(
    [string]$Path,
    [string]$ReleaseRoot
  )
  $full = [System.IO.Path]::GetFullPath($Path)
  $releaseFull = [System.IO.Path]::GetFullPath($ReleaseRoot)
  if (-not $full.StartsWith($releaseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "Refusing to modify outside release directory: $full"
  }
}

function Test-ExcludedReleasePath {
  param([string]$RelativePath)
  $norm = $RelativePath.Replace('/', '\')

  $excludePrefixes = @(
    '.agent',
    '.agents',
    '.git',
    'release',
    'test-harness\node_modules',
    'test-harness\test-results',
    'test-harness\playwright-report',
    'lms_tool\data',
    'lms_tool\downloads'
  )
  foreach ($prefix in $excludePrefixes) {
    if ($norm.Equals($prefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $norm.StartsWith($prefix + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  $excludeDirNames = @(
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    'node_modules',
    'test-results',
    'playwright-report'
  )
  foreach ($part in $norm.Split('\')) {
    foreach ($dirName in $excludeDirNames) {
      if ($part.Equals($dirName, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
    }
  }

  $fileName = Split-Path -Leaf $norm
  $excludeFilePatterns = @(
    '*.pyc',
    '*.pyo',
    '*.log',
    '*.tmp',
    '*.bak',
    '*.db',
    '*.sqlite',
    '*.sqlite3',
    '*.pid',
    '*.cache',
    '*.pem',
    '*.key',
    '*.cert',
    '*.crt',
    '*.local',
    '*.local.*',
    'backup-*.json',
    'aichat-backup-*.json',
    'request-history*.json',
    'request_history*.json',
    '.env',
    '.env.*',
    '.lms_cookie',
    'debug.log'
  )
  foreach ($pattern in $excludeFilePatterns) {
    if ($fileName -like $pattern) {
      return $true
    }
  }
  return $false
}

function Get-ReleaseInputRoots {
  return @(
    '.gitignore',
    'AI-Chat-*.html',
    'README.md',
    'requirements.txt',
    'local_terminal_server.py',
    'start_agent.bat',
    'start_agent.sh',
    'quality-check.bat',
    'quality-check.ps1',
    'build-release.bat',
    'build-release.ps1',
    'css',
    'icon',
    'js',
    'lms_tool',
    'music',
    'server',
    'skill',
    'vendor',
    'tests',
    'test-harness'
  )
}

function Copy-ReleaseFiles {
  param(
    [string]$Stage
  )

  $script:ReleaseCopied = 0
  foreach ($entry in Get-ReleaseInputRoots) {
    $src = Join-Path $Root $entry
    if ($entry.IndexOfAny([char[]]'*?') -ge 0) {
      $items = @(Get-ChildItem -Path $src -Force -ErrorAction SilentlyContinue)
    } else {
      if (-not (Test-Path -LiteralPath $src)) {
        Fail "Missing release input: $entry"
      }
      $items = @(Get-Item -LiteralPath $src -Force)
    }

    if ($items.Count -eq 0) {
      Fail "Missing release input: $entry"
    }

    foreach ($item in $items) {
      if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -Force -File | ForEach-Object {
          $rel = $_.FullName.Substring($Root.Length + 1)
          if (-not (Test-ExcludedReleasePath $rel)) {
            $dest = Join-Path $Stage $rel
            $parent = Split-Path -Parent $dest
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
            $script:ReleaseCopied += 1
          }
        }
      } else {
        $rel = $item.FullName.Substring($Root.Length + 1)
        if (-not (Test-ExcludedReleasePath $rel)) {
          $dest = Join-Path $Stage $rel
          Copy-Item -LiteralPath $item.FullName -Destination $dest -Force
          $script:ReleaseCopied += 1
        }
      }
    }
  }
  return $script:ReleaseCopied
}

function Get-RiskyReleaseFiles {
  param([string]$Stage)

  Get-ChildItem -LiteralPath $Stage -Recurse -Force -File |
    Where-Object {
      $rel = $_.FullName.Substring($Stage.Length + 1).Replace('/', '\')
      return (
        $rel -match '\\(\.git|\.agent|\.agents|node_modules|__pycache__|test-results|playwright-report|data|downloads)\\' -or
        $_.Name -match '(?i)(\.env|\.pem|\.key|\.cert|\.crt|\.log|\.db|\.sqlite|\.bak|\.tmp|backup-.*\.json|aichat-backup-.*\.json|request-history.*\.json|request_history.*\.json|\.local|\.lms_cookie$)'
      )
    }
}

function Invoke-PrivacyScan {
  param([string]$Stage)

  $riskyFiles = @(Get-RiskyReleaseFiles $Stage)
  if ($riskyFiles.Count -gt 0) {
    $details = ($riskyFiles | Select-Object -First 20 | ForEach-Object { $_.FullName }) -join "`n"
    Fail "Risky file names found in release stage:`n$details"
  }

  $textExtensions = @(
    '.bat',
    '.css',
    '.html',
    '.js',
    '.json',
    '.md',
    '.mjs',
    '.ps1',
    '.py',
    '.sh',
    '.txt',
    '.xml',
    '.yaml',
    '.yml'
  )
  $patterns = @(
    '(?<![A-Za-z0-9_])sk-(?:proj-)?[A-Za-z0-9_-]{20,}',
    '(?<![A-Za-z0-9_])sk-ant-(?:api|admin)\d*-[A-Za-z0-9_-]{20,}',
    '\bgh[pousr]_[A-Za-z0-9]{36}\b',
    'github_pat_[A-Za-z0-9_]{20,}',
    '\bAIza[0-9A-Za-z_-]{35}\b',
    'xox[baprs]-[A-Za-z0-9-]{10,}',
    '-----BEGIN (?:RSA |DSA |EC |OPENSSH |)?PRIVATE KEY-----',
    'Bearer\s+[A-Za-z0-9._-]{20,}',
    'Authorization:\s*Basic\s+[A-Za-z0-9+/=]{20,}',
    '(?i)(api[_-]?key|apikey|secret|password|passwd|cookie|token|authorization)\s*[:=]\s*["''][A-Za-z0-9_./+=:-]{32,}["'']'
  )

  $findings = New-Object System.Collections.Generic.List[string]
  Get-ChildItem -LiteralPath $Stage -Recurse -Force -File |
    Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
      $file = $_
      try {
        $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
      } catch {
        return
      }
      foreach ($pattern in $patterns) {
        $matches = [regex]::Matches($text, $pattern)
        foreach ($m in $matches) {
          $sample = $m.Value
          if ($sample -match '\*\*\*|\[FAKE_|xxxxxxxx|<[^>]+>|\.\.\.|example|mock|fake') {
            continue
          }
          $rel = $file.FullName.Substring($Stage.Length + 1)
          $findings.Add(("{0}: {1}" -f $rel, $pattern))
        }
      }
    }

  if ($findings.Count -gt 0) {
    $details = ($findings | Select-Object -First 30) -join "`n"
    Fail "Possible secret patterns found in release stage:`n$details"
  }
}

function Write-ReleaseFiles {
  param(
    [string]$Stage,
    [string]$ReleaseName
  )

  $privacyPath = Join-Path $Stage 'PRIVACY_CHECK.txt'
  $privacy = @(
    "Privacy check for $ReleaseName",
    "Checked: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    '',
    'Scanned release staging directory for:',
    '- OpenAI/Anthropic/GitHub/Google/Slack style token patterns',
    '- Private key block markers',
    '- Bearer/Basic authorization literals',
    '- quoted apiKey/secret/password/passwd/cookie/token/authorization assignments',
    '- risky file names such as .env, .pem, .key, .log, .db, .sqlite, .lms_cookie',
    '',
    'Result: no real credential/token/private-key pattern found in release staging files.',
    'Excluded from package: .git, .agent, .agents, node_modules, logs, caches, local credentials, LMS data/downloads, Playwright reports/results.'
  )
  Set-Content -LiteralPath $privacyPath -Value $privacy -Encoding UTF8

  $notesPath = Join-Path $Stage 'RELEASE_NOTES.txt'
  $notes = @(
    "$ReleaseName source release",
    '',
    'This package contains the browser frontend, Python local backend, assets, tests, quality-check scripts, and release build scripts.',
    'Install Python dependencies with: pip install -r requirements.txt',
    'Install E2E dependencies only when needed: cd test-harness; npm install; npm run install:browser',
    'Start on Windows with: start_agent.bat',
    '',
    'Privacy policy for this package: local state, credentials, logs, caches, .agent, .git, node_modules, LMS data/downloads, and test artifacts are excluded.'
  )
  Set-Content -LiteralPath $notesPath -Value $notes -Encoding UTF8

  $manifestPath = Join-Path $Stage 'RELEASE_MANIFEST.txt'
  $files = Get-ChildItem -LiteralPath $Stage -Recurse -Force -File | Sort-Object FullName
  $manifest = @()
  $manifest += "Release: $ReleaseName"
  $manifest += "Built: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
  $manifest += "File count: $($files.Count)"
  $manifest += ''
  $manifest += 'Excluded by policy: .git, .agent, .agents, node_modules, caches, logs, local credentials, LMS data/downloads, Playwright reports/results.'
  $manifest += ''
  $manifest += 'Files:'
  foreach ($file in $files) {
    $rel = $file.FullName.Substring($Stage.Length + 1)
    $manifest += ("{0}`t{1}" -f $file.Length, $rel)
  }
  Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
}

try {
  if ($Version -match '[\\/:*?"<>|]' -or $Platform -match '[\\/:*?"<>|]') {
    Fail 'Version and Platform cannot contain path separator or Windows reserved filename characters.'
  }

  $dateStamp = Get-Date -Format 'yyyyMMdd'
  $releaseName = "Snake-Agent-$Version-$Platform-$dateStamp"
  $releaseRoot = Join-Path $Root 'release'
  $stage = Join-Path $releaseRoot $releaseName
  $zip = Join-Path $releaseRoot ($releaseName + '.zip')
  $shaPath = $zip + '.sha256.txt'

  Write-Host 'Snake Agent release builder' -ForegroundColor White
  Write-Host "Root: $Root"
  Write-Host "Release: $releaseName"

  if (-not $SkipQuality) {
    Write-Section 'Quality check'
    if ($FullE2E) {
      Invoke-CheckedCommand (Join-Path $Root 'quality-check.bat') @()
    } else {
      Invoke-CheckedCommand (Join-Path $Root 'quality-check.bat') @('-SkipE2E')
    }
  } else {
    Write-Section 'Quality check'
    Write-Host 'Skipped by -SkipQuality.' -ForegroundColor Yellow
  }

  Write-Section 'Prepare output'
  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  foreach ($target in @($stage, $zip, $shaPath)) {
    if (Test-Path -LiteralPath $target) {
      if (-not $Force) {
        Fail "Release output already exists. Re-run with -Force to replace: $target"
      }
      Assert-SafeReleasePath -Path $target -ReleaseRoot $releaseRoot
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  Write-Section 'Copy release files'
  $copied = Copy-ReleaseFiles -Stage $stage
  Write-Host "Copied files: $copied"

  Write-Section 'Privacy scan'
  Invoke-PrivacyScan -Stage $stage
  Write-Host 'No obvious credential or risky local file found.' -ForegroundColor Green

  Write-Section 'Write release metadata'
  Write-ReleaseFiles -Stage $stage -ReleaseName $releaseName

  Write-Section 'Create archive'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  Set-Content -LiteralPath $shaPath -Value ("{0}  {1}" -f $hash.Hash, (Split-Path -Leaf $zip)) -Encoding ASCII

  if (-not $KeepStage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }

  Write-Host ''
  Write-Host 'RELEASE BUILD PASSED' -ForegroundColor Green
  Write-Host "Zip: $zip"
  Write-Host "SHA256: $($hash.Hash)"
  Write-Host "Checksum file: $shaPath"
  if ($KeepStage) {
    Write-Host "Stage: $stage"
  }
  exit 0
} catch {
  Write-Host ''
  Write-Host 'RELEASE BUILD FAILED' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
