# Official source lock — Evaluation V1

Retrieved on `2026-09-14`. These sources define the implementation assumptions
used by `AgentEvaluationJudge` and the provider harness.

## GenLayer

- Intelligent Contract testing: <https://docs.genlayer.com/developers/intelligent-contracts/testing>
- `genlayer-test` API: <https://docs.genlayer.com/api-references/genlayer-test>
- Tooling setup: <https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup>
- Equivalence principle: <https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle>
- Non-determinism: <https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism>
- Calling LLMs: <https://docs.genlayer.com/developers/intelligent-contracts/features/calling-llms>
- Deployment: <https://docs.genlayer.com/developers/intelligent-contracts/deploying>

Locked implementation family: `genlayer` CLI `0.39.2`, `genvm-linter` `0.11.0`,
validation bundle `v0.2.16`, `genlayer-py` `v0.18`, `genlayer-test` `v0.29`, and
runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
The target network is Studionet (`61999`), not Studio Dev/local (`61997`).
The active bounded scorecard revision is `AgentEvaluationV5`. Its validator uses
an independent evidence audit with explicit grade anchors and one-adjacent-tier
tolerance, while critical safety/rule `FAIL` and `NOT_APPLICABLE` boundaries
remain exact. Revisions V1–V4 are archived with their observed consensus failure
instead of being treated as successful evidence.

## Agent/provider boundary

- OpenAI Agents SDK agents/instructions: <https://openai.github.io/openai-agents-python/agents/>
- Running agents: <https://openai.github.io/openai-agents-python/running_agents/>
- Tools: <https://openai.github.io/openai-agents-python/tools/>
- Guardrails: <https://openai.github.io/openai-agents-python/guardrails/>
- Testing: <https://openai.github.io/openai-agents-python/testing/>

The relevant boundary is structural: instructions determine behavior, while
tools are executable capabilities and guardrails/approval are separate control
layers. Therefore Level 2 sends a catalog as inert JSON rather than exposing
provider tools. This project does not claim OpenAI Agents SDK is the configured
provider runtime; these official pages are design references for the separation.
