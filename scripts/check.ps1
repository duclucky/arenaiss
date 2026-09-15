$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$env:GENVM_VERSION = 'v0.6.0-rc5'

& "$PSScriptRoot\..\.venv\Scripts\genvm-lint.exe" check "$PSScriptRoot\..\contracts\archive\ArenaMatchJudge.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& "$PSScriptRoot\..\.venv\Scripts\genvm-lint.exe" check "$PSScriptRoot\..\contracts\AgentEvaluationJudge.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& "$PSScriptRoot\..\.venv\Scripts\genvm-lint.exe" check "$PSScriptRoot\..\contracts\ArenaComparisonJudge.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& "$PSScriptRoot\..\.venv\Scripts\python.exe" -m pytest "$PSScriptRoot\..\tests\direct" -v
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& node --test `
  "$PSScriptRoot\..\packages\protocol\test\canonical.test.ts" `
  "$PSScriptRoot\..\packages\domain\test\policy.test.ts" `
  "$PSScriptRoot\..\packages\domain\test\bracket.test.ts" `
  "$PSScriptRoot\..\packages\domain\test\progression.test.ts" `
  "$PSScriptRoot\..\packages\arc\test\escrow-port.test.ts" `
  "$PSScriptRoot\..\packages\inference\test\pair-runner.test.ts" `
  "$PSScriptRoot\..\packages\inference\test\openai-provider.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\protocol.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\policy.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\provider.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\corpus.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\run-tracker.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\solo-runner.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\comparison.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\tournament-comparison.test.ts" `
  "$PSScriptRoot\..\packages\evaluation\test\tournament-runner.test.ts" `
  "$PSScriptRoot\..\packages\marketplace\test\eligibility.test.ts" `
  "$PSScriptRoot\..\packages\genlayer\test\tracker.test.ts" `
  "$PSScriptRoot\..\packages\genlayer\test\sdk-port.test.ts" `
  "$PSScriptRoot\..\packages\genlayer\test\evaluation-sdk-port.test.ts" `
  "$PSScriptRoot\..\packages\genlayer\test\comparison-tracker.test.ts" `
  "$PSScriptRoot\..\packages\genlayer\test\studio-next-chain.test.ts" `
  "$PSScriptRoot\..\packages\orchestrator\test\orchestrator.test.ts" `
  "$PSScriptRoot\..\packages\settlement\test\worker.test.ts" `
  "$PSScriptRoot\..\packages\settlement\test\auto-payout.test.ts" `
  "$PSScriptRoot\..\packages\persistence\test\store.test.ts" `
  "$PSScriptRoot\..\packages\persistence\test\sqlite-runtime.test.ts" `
  "$PSScriptRoot\..\services\api\test\service.test.ts" `
  "$PSScriptRoot\..\services\api\test\marketplace-arc.test.ts" `
  "$PSScriptRoot\..\services\api\test\marketplace-service.test.ts" `
  "$PSScriptRoot\..\services\api\test\marketplace-http.test.ts" `
  "$PSScriptRoot\..\services\api\test\http.test.ts" `
  "$PSScriptRoot\..\services\api\test\managed-identity.test.ts" `
  "$PSScriptRoot\..\services\api\test\circle-managed-wallet.test.ts" `
  "$PSScriptRoot\..\services\api\test\server.test.ts" `
  "$PSScriptRoot\..\tests\ops\backup.test.ts" `
  "$PSScriptRoot\..\tests\ops\seed-live-demo.test.ts" `
  "$PSScriptRoot\..\tests\system\trusted-operator-lifecycle.test.ts" `
  "$PSScriptRoot\..\tests\system\evaluation-tournament-convergence.test.ts" `
  "$PSScriptRoot\..\tests\system\release-candidate.test.ts"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& forge test --root "$PSScriptRoot\.."
exit $LASTEXITCODE
