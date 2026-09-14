$ErrorActionPreference = "Stop"

Write-Host "Checking frontend..."
cd "$PSScriptRoot\..\frontend"

Write-Host "Running typecheck..."
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running tests..."
npm run test:run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running production build..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Frontend checks passed."
