param(
    [Parameter(Mandatory = $true)]
    [string]$ContractAddress,

    [Parameter(Mandatory = $true)]
    [ValidateSet('GeneralResponseV2', 'GeneralResponseV3', 'GeneralResponseV4', 'GeneralResponseV5', 'GeneralResponseV6', 'GeneralResponseV7')]
    [string]$RubricVersion,

    [hashtable]$AttemptIds = @{}
)

$ErrorActionPreference = 'Continue'
$env:PYTHONUTF8 = '1'

$corpusPath = Join-Path $PSScriptRoot '..\tests\fixtures\genlayer\adversarial_corpus.json'
$corpus = Get-Content -Raw -LiteralPath $corpusPath | ConvertFrom-Json

function Get-Field([string]$Text, [string]$Pattern) {
    $match = [regex]::Match($Text, $Pattern, 'IgnoreCase')
    if ($match.Success) { return $match.Groups[1].Value }
    return ''
}

$networkRaw = (& genlayer config get network 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $networkRaw -notmatch 'studionet') {
    throw 'Network guard: active GenLayer CLI network is not studionet.'
}

$configRaw = (& genlayer call $ContractAddress get_config 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $configRaw -notmatch [regex]::Escape($RubricVersion)) {
    throw "Contract guard: get_config does not expose rubric $RubricVersion."
}

$results = @()
foreach ($case in $corpus.cases) {
    $matchId = [string]$case.id
    $attemptId = if ($AttemptIds.ContainsKey($matchId)) {
        [string]$AttemptIds[$matchId]
    } else {
        'attempt_01'
    }
    $raw = (& genlayer call $ContractAddress get_match_result --args $matchId $attemptId 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Canonical read failed for $matchId."
    }
    $status = Get-Field $raw "status:\s*'([^']+)'"
    $result = Get-Field $raw "result:\s*'([^']+)'"
    $scoreA = Get-Field $raw 'score_a:\s*(\d+)'
    $scoreB = Get-Field $raw 'score_b:\s*(\d+)'
    $safetyClass = Get-Field $raw "safety_class:\s*'([^']+)'"
    $winners = [regex]::Matches($raw, "winner:\s*'([^']+)'") | ForEach-Object {
        $_.Groups[1].Value
    }
    $resultAllowed = [string[]]$case.allowed_results -contains $result
    $expectedSafetyClass = if ($null -ne $case.expected_safety_class) {
        [string]$case.expected_safety_class
    } else {
        ''
    }
    $safetyClassAllowed = -not $expectedSafetyClass -or $safetyClass -eq $expectedSafetyClass
    $allowed = $resultAllowed -and $safetyClassAllowed
    $results += [ordered]@{
        case_id = $matchId
        attempt_id = $attemptId
        status = $status
        result = $result
        score_a = [int]$scoreA
        score_b = [int]$scoreB
        safety_class = $safetyClass
        expected_safety_class = $expectedSafetyClass
        decision_vector = $winners -join '|'
        allowed = $allowed
    }
}

$repeatIds = @('adv_equivalent_repeat_1', 'adv_equivalent_repeat_2', 'adv_equivalent_repeat_3')
$repeatResults = $results | Where-Object { $_.case_id -in $repeatIds } | ForEach-Object { $_.result }
$repeatStable = ($repeatResults | Select-Object -Unique).Count -eq 1
$failed = @($results | Where-Object { $_.status -ne 'FINAL' -or -not $_.allowed })

[ordered]@{
    schema_version = 'arena-adversarial-live-summary-v1'
    network = 'Studionet'
    chain_id = 61999
    contract_address = $ContractAddress
    rubric_version = $RubricVersion
    total_cases = $results.Count
    final_cases = @($results | Where-Object status -eq 'FINAL').Count
    allowed_cases = @($results | Where-Object allowed).Count
    failed_case_ids = @($failed | ForEach-Object case_id)
    semantic_repeat_stable = $repeatStable
    results = $results
} | ConvertTo-Json -Depth 6 -Compress
