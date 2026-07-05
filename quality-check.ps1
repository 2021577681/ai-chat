param(
  [switch]$SkipE2E,
  [switch]$E2EOnly,
  [switch]$KeepArtifacts,
  [switch]$NoClean
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$StartTime = Get-Date

function Write-Section {
  param([string]$Title)
  Write-Host ''
  Write-Host "==> $Title" -ForegroundColor Cyan
}

function Fail {
  param([string]$Message)
  throw $Message
}

function Test-CommandAvailable {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  Write-Section $Name
  $stepStart = Get-Date
  & $Body
  $elapsed = ((Get-Date) - $stepStart).TotalSeconds
  Write-Host ("OK: {0} ({1:N1}s)" -f $Name, $elapsed) -ForegroundColor Green
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

function Get-RepoFiles {
  param(
    [string[]]$Extensions,
    [string[]]$ExtraExcludes = @()
  )
  $excludedDirs = @(
    '.git',
    '.agent',
    '.agents',
    '.venv',
    'venv',
    'env',
    'node_modules',
    'release',
    'test-results',
    'playwright-report'
  ) + $ExtraExcludes

  Get-ChildItem -Path $Root -Recurse -File -Force |
    Where-Object {
      $file = $_
      if ($Extensions -notcontains $file.Extension.ToLowerInvariant()) { return $false }
      $relative = Resolve-Path -LiteralPath $file.FullName -Relative
      foreach ($dir in $excludedDirs) {
        if ($relative -like ".\$dir\*" -or $relative -like ".\*\$dir\*") { return $false }
      }
      return $true
    } |
    Sort-Object FullName
}

function Remove-GeneratedQualityArtifacts {
  if ($NoClean -or $KeepArtifacts) { return }

  Write-Section 'Clean generated quality-check artifacts'
  $targets = @()
  $targets += Get-ChildItem -Path $Root -Recurse -Directory -Filter '__pycache__' -Force -ErrorAction SilentlyContinue

  foreach ($path in @(
    'debug.log',
    'test-harness\test-results',
    'test-harness\playwright-report',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    'coverage',
    '.nyc_output'
  )) {
    $full = Join-Path $Root $path
    if (Test-Path -LiteralPath $full) {
      $targets += Get-Item -LiteralPath $full -Force
    }
  }

  $removed = 0
  foreach ($target in $targets) {
    $full = $target.FullName
    if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      Fail "Refusing to remove outside workspace: $full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    $removed += 1
  }
  Write-Host "Removed generated directories: $removed"
}

try {
  Write-Host 'AI Chat quality check' -ForegroundColor White
  Write-Host "Root: $Root"
  if ($SkipE2E -and $E2EOnly) {
    Fail 'Use either -SkipE2E or -E2EOnly, not both.'
  }

  Invoke-Step 'Prerequisites' {
    if (-not (Test-CommandAvailable 'node')) { Fail 'node is required.' }
    Invoke-CheckedCommand 'node' @('--version')

    if (-not $E2EOnly) {
      if (-not (Test-CommandAvailable 'python')) { Fail 'python is required.' }
      Invoke-CheckedCommand 'python' @('--version')
    }

    if (-not $SkipE2E) {
      if (-not (Test-CommandAvailable 'npm')) { Fail 'npm is required for E2E dependency setup.' }
      Invoke-CheckedCommand 'npm' @('--version')
    }
  }

  if (-not $E2EOnly) {

    Invoke-Step 'JavaScript syntax check' {
      $jsFiles = Get-RepoFiles -Extensions @('.js')
      if (-not $jsFiles.Count) { Fail 'No JavaScript files found.' }
      foreach ($file in $jsFiles) {
        Invoke-CheckedCommand 'node' @('--check', $file.FullName)
      }
      Write-Host ("Checked JS files: {0}" -f $jsFiles.Count)
    }

    Invoke-Step 'Python syntax check' {
      $pyFiles = Get-RepoFiles -Extensions @('.py')
      if (-not $pyFiles.Count) { Fail 'No Python files found.' }
      $args = @('-m', 'py_compile') + @($pyFiles | ForEach-Object { $_.FullName })
      Invoke-CheckedCommand 'python' $args
      Write-Host ("Checked Python files: {0}" -f $pyFiles.Count)
    }

    Invoke-Step 'Python unit tests' {
      Invoke-CheckedCommand 'python' @('-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py')
    }
  }

  if (-not $SkipE2E) {
    Invoke-Step 'E2E tests' {
      $playwrightPackage = Join-Path $Root 'test-harness\node_modules\@playwright\test\package.json'
      if (-not (Test-Path -LiteralPath $playwrightPackage)) {
        Fail 'Playwright is not installed. Run: cd test-harness; npm install; npm run install:browser'
      }
      Invoke-CheckedCommand 'node' @('tests\e2e\run-e2e.js')
    }
  } else {
    Write-Section 'E2E tests'
    Write-Host 'Skipped by -SkipE2E.' -ForegroundColor Yellow
  }

  Remove-GeneratedQualityArtifacts

  $elapsedTotal = ((Get-Date) - $StartTime).TotalSeconds
  Write-Host ''
  Write-Host ("QUALITY CHECK PASSED ({0:N1}s)" -f $elapsedTotal) -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host 'QUALITY CHECK FAILED' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (-not $NoClean -and -not $KeepArtifacts) {
    Write-Host 'Artifacts are retained after failure for debugging. Use -NoClean or -KeepArtifacts to make that explicit.' -ForegroundColor Yellow
  }
  exit 1
}
