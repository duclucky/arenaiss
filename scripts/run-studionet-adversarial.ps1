param(
    [Parameter(Mandatory = $true)]
    [string]$ContractAddress,

    [Parameter(Mandatory = $true)]
    [ValidateSet('GeneralResponseV2', 'GeneralResponseV3', 'GeneralResponseV4', 'GeneralResponseV5', 'GeneralResponseV6', 'GeneralResponseV7')]
    [string]$RubricVersion,

    [string[]]$SkipCaseIds = @(),

    [hashtable]$AttemptIds = @{},

    [Parameter(Mandatory = $true)]
    [switch]$Execute
)

$ErrorActionPreference = 'Continue'
$env:PYTHONUTF8 = '1'

if (-not $Execute) {
    throw 'Mutation guard: pass -Execute only after explicit action-time authorization.'
}

$corpusPath = Join-Path $PSScriptRoot '..\tests\fixtures\genlayer\adversarial_corpus.json'
$corpus = Get-Content -Raw -LiteralPath $corpusPath | ConvertFrom-Json

function Get-Sha256Digest([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return 'sha256:' + ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
}

function Get-Field([string]$Text, [string]$Pattern) {
    $match = [regex]::Match($Text, $Pattern, 'IgnoreCase')
    if ($match.Success) { return $match.Groups[1].Value }
    return ''
}

$networkRaw = (& genlayer config get network 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw 'Network guard: unable to read the active GenLayer CLI network.'
}
if ($networkRaw -notmatch 'studionet') {
    throw 'Network guard: active GenLayer CLI network is not studionet.'
}

$configRaw = (& genlayer call $ContractAddress get_config 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw 'Contract guard: unable to read get_config.'
}
if ($configRaw -notmatch [regex]::Escape($RubricVersion)) {
    throw "Contract guard: get_config does not expose rubric $RubricVersion."
}

foreach ($case in $corpus.cases) {
    $matchId = [string]$case.id
    $attemptId = if ($AttemptIds.ContainsKey($matchId)) {
        [string]$AttemptIds[$matchId]
    } else {
        'attempt_01'
    }
    if ($SkipCaseIds -contains $matchId) {
        [pscustomobject]@{
            case = $matchId
            action = 'SKIP_REQUESTED'
        } | ConvertTo-Json -Compress
        continue
    }
    $stateRaw = (& genlayer call $ContractAddress get_match_result --args $matchId $attemptId 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "State guard: unable to read canonical state for $matchId."
    }
    $canonicalStatus = Get-Field $stateRaw "status:\s*'([^']+)'"
    if ($canonicalStatus -eq 'FINAL') {
        $canonicalResult = Get-Field $stateRaw "result:\s*'([^']+)'"
        [pscustomobject]@{
            case = $matchId
            action = 'SKIP_EXISTING_FINAL'
            canonical_status = $canonicalStatus
            canonical_result = $canonicalResult
        } | ConvertTo-Json -Compress
        continue
    }
    if ($canonicalStatus -ne 'UNKNOWN') {
        throw "State guard: $matchId returned unexpected canonical status '$canonicalStatus'."
    }

    $digestA = Get-Sha256Digest ([string]$case.output_a)
    $digestB = Get-Sha256Digest ([string]$case.output_b)
    $writeArgs = @(
        'write',
        $ContractAddress,
        'submit_match',
        '--args',
        $matchId,
        $attemptId,
        [string]$case.topic,
        [string]$case.output_a,
        [string]$case.output_b,
        $digestA,
        $digestB,
        $RubricVersion
    )
    if ($writeArgs.Count -ne 12) {
        throw "Transport guard: $matchId did not produce exactly 12 native CLI arguments."
    }
    $raw = (& genlayer @writeArgs 2>&1 | Out-String)
    $writeExitCode = $LASTEXITCODE

    $tx = Get-Field $raw 'Write Transaction Hash:\s*(0x[0-9a-fA-F]{64})'
    $status = Get-Field $raw "status_name:\s*'([^']+)'"
    $result = Get-Field $raw "result_name:\s*'([^']+)'"
    $execution = Get-Field $raw "execution_result:\s*'([^']+)'"

    if (-not $tx) {
        $recoveryRaw = (& genlayer call $ContractAddress get_match_result --args $matchId $attemptId 2>&1 | Out-String)
        $recoveryStatus = Get-Field $recoveryRaw "status:\s*'([^']+)'"
        [pscustomobject]@{
            case = $matchId
            action = 'AMBIGUOUS_CLI_OUTPUT_NO_RETRY'
            canonical_status = $recoveryStatus
        } | ConvertTo-Json -Compress
        throw "Submission output for $matchId had no transaction hash; no retry was attempted."
    }
    if ($writeExitCode -ne 0) {
        throw "Submission command for $matchId returned exit code $writeExitCode after transaction $tx."
    }

    [pscustomobject]@{
        case = $matchId
        action = 'SUBMITTED'
        transaction = $tx
        status = $status
        consensus_result = $result
        execution = $execution
    } | ConvertTo-Json -Compress

    if ($execution -ne 'SUCCESS') {
        throw "Submission execution failed for $matchId after transaction $tx."
    }
    if ($status -notin @('ACCEPTED', 'FINALIZED')) {
        throw "Submission returned unexpected consensus status '$status' for $matchId after transaction $tx."
    }
    if ($result -ne 'MAJORITY_AGREE') {
        throw "Submission returned unexpected consensus result '$result' for $matchId after transaction $tx."
    }
}
