---
title: 'My coding agents got slow. The models were fine.'
date: 2026-10-15T09:00:00+02:00
draft: true
author: 'Marcin Skalski'
---

For a few days in October every agent I ran felt slow. Claude Code, Codex, opencode and [Sail](https://github.com/smykla-skalski/sail) all took far too long to finish anything. My first guess was the models: new versions, higher effort, maybe a bad week for the APIs.

The models were fine. My Mac was drowning.

## The setup

One MacBook with 14 cores and 36 GB of RAM. On a busy day it ran about 10 agent turns at once, 24k Codex model responses and 20k shell commands. Most of that was parallel work: worktrees, subagents, reviewers, test runs.

I never recorded a baseline from before the slowdown. The observer I wrote for exactly this, [reef](https://github.com/smykla-skalski/reef), started on the same day things got slow. So I rebuilt the baseline from logs the agents already keep:

- Claude Code transcripts in `~/.claude/projects` (2.6 GB)
- Codex session logs in `~/.codex/sessions` (17 GB) and its `logs_2.sqlite`
- opencode's `opencode.db`
- reef's per-minute host samples, plus the [bilgie](https://github.com/smykla-skalski/bilgie) disk janitor's run log
- live snapshots from `ps`, `top`, `vm_stat` and `iostat`

Agent transcripts are a great data source. Every tool call has a timestamp, so turn time, tool time, approvals and waits all come out of them.

## What it wasn't

| Suspect      | What the data said                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Model APIs   | They got faster. Codex p50 went from 5.75 s to 4.15 s for the same model; Claude's first block from 3.27 s to 2.77 s |
| Network      | Time to first byte 0.05–0.3 s, no port exhaustion                                                                    |
| Hooks        | About 2% of Claude's wall time                                                                                       |
| Context size | Flat or lower                                                                                                        |
| Thermals     | No throttling recorded                                                                                               |

One chart settled it. On October 12–14, Codex command time followed host CPU: 0.5 s at the median when the Mac was under 40% CPU, and 2.7 s at 70% or more. Model latency did not change with load at all. **Load slowed the tools, not the model.**

## What it was

### Twice the work

From October 9, Codex model responses per day went from 11.5k to 24.1k, and concurrent turns from 5 to 10. That part was my doing, and it was fine on its own. What hurt was everything that multiplied with it.

### 253 MCP servers, almost none of them used

Every agent session starts every globally configured MCP server. Long-lived processes, such as the Codex app-server daemon and `opencode serve`, keep one set per thread and rarely let go. After five days the Codex daemon held about 4.9 GB and 114 child processes.

The count across the machine was 253 MCP server processes, wrappers included. The top-level servers were 63 Peekaboo, 61 chrome-devtools and 60 of Sail's memory server. Together, the 63 Peekaboo processes used 59–75% of a CPU core while doing nothing. Peekaboo's tool schemas cost about 14k tokens per session, and Claude called it **zero times** in 18 days. The agents used Peekaboo through its CLI instead.

### Swap

Swap sat at 18.8 of 20 GiB, with 62 GiB of memory compressed into 14 GiB of RAM. The load average was 47–66 on 14 cores.

### A full disk, and my own rule did it

On October 8 I had told agents to put build caches in a fresh scratch folder per task, so leftovers would be easy to delete. That included `GOCACHE`, the npm cache and the uv cache. So every task rebuilt and re-downloaded everything cold. Codex compilers and linkers wrote 1.1 TiB in five days. Task folders grew to 40–50 GB each, and free disk fell from 237 GiB to 2.9 GiB.

bilgie, my disk janitor, was supposed to catch exactly this. Its emergency pass freed nothing: the stale-folder sweep spent the whole 45-minute deadline on per-folder `lsof +D` calls.

### The approval tax

Codex's auto-reviewer ran 38,162 reviews in 16 days. They added up to 24 hours of review time and denied 0.26% of commands. On October 13, 92.6% of Codex requests asked for escalation before trying the sandbox at all.

Allowlists didn't help as much as I expected. Over the 18 days before the fix, only 24% of Claude's Bash calls matched an allow rule, and only about a third of Codex's requests had a shape a prefix rule can match. Env prefixes, `timeout` wrappers, redirects and heredocs all defeat prefix matching.

### Waiting on subagents

Main Codex threads spent 51% of their time waiting on subagents, up from 21%. A slow subagent makes every parent above it slow.

### Background noise

Spotlight kept reindexing agent worktrees, with `mds_stores` peaking at 126% CPU. Two endpoint security agents inspected every process launch. Sail rewrote a 1.9 MB settings file about once a second.

## The guardrails that backfired

The uncomfortable part is that most of this came from things I added to keep agents in check:

- The per-task cache rule was meant to stop scratch folders from leaking. It multiplied disk and I/O.
- The MCP servers were each a reasonable idea: browser automation, UI automation, shared memory. Long-lived daemons multiplied them.
- The observer that should have shown me all this started one day too late.

Every guardrail has a cost, and the cost grows with the number of agents.

## The fixes

- **MCP servers are opt-in.** Peekaboo is gone; the skill drives its CLI. chrome-devtools moved into the `build` agent profile only. Claude Code agent definitions can declare inline `mcpServers`, which start with the agent and stop when it finishes. The process count went from 253 to 41. opencode has no per-agent MCP setting, so chrome-devtools is off there entirely. My first try there used `enabled: false`, which opencode 2 silently ignores; the key is `disabled: true`.
- **Long-lived daemons get restarted.**
- **Shared caches stay shared.** Only `CARGO_TARGET_DIR` and `GOTMPDIR` go in the per-task folder.
- **Plain commands, sandbox first.** Agents are told to drop `VAR=` prefixes, wrappers and redirects, so allow rules match. Codex tries the sandbox first and escalates one plain command at a time.
- **Spotlight skips the dev folders.** Search Privacy in System Settings is the only supported way to exclude a folder. I first turned indexing off for the whole Mac, thinking Raycast kept its own index. It doesn't, and app search broke within hours, so indexing went back on with my code folders excluded.
- **One permission list for every agent.**

That last one deserves a closer look. Each agent has its own permission format: Claude Code has `Bash(cmd:*)` rules in JSON, Codex has Starlark `prefix_rule`s, and opencode has glob keys where the last match wins. I now keep a single list in [zakwas](https://github.com/Automaat/zakwas), the tool that sets up my Mac:

```yaml
agents:
  permissions:
    allow:
      - git status
      - go test
      - cargo
      - gh pr
    deny:
      - git push --force
      - git commit --no-verify
      - sudo
```

[zakwas 0.8.0](https://github.com/Automaat/zakwas/releases/tag/v0.8.0) renders it three ways:

- `Bash(git status:*)` in Claude's `settings.json`, tracking only the rules it owns
- `prefix_rule(pattern=["git", "status"], decision="allow")` in a Codex rules file
- `"git status": "allow"` plus `"git status *": "allow"` in the opencode config

That came to 228 allow and 8 deny rules for every agent. Replayed against the previous 18 days of Claude's Bash calls, the new list would have matched 67.6% of them, up from 23.8%. Two details matter:

- In Codex, an allow rule runs the command outside the sandbox. A single parse error in any rules file drops every user rule.
- Claude Code's auto mode ignores very broad rules, such as `Bash(*)` or any package-manager `run`. So I list specific forms like `npm run lint`.

I also filed what I found upstream: [Sail's idle resource use](https://github.com/smykla-skalski/sail/issues/691), [bilgie on agent-sized disk usage](https://github.com/smykla-skalski/bilgie/issues/308), and [klaudiush false positives](https://github.com/smykla-skalski/klaudiush/issues/869) hit during the fix itself.

## Results

Before is October 9–14 and After is October 15–21. The same scripts computed both, so a few figures differ from the ones above, which came from the windows I used while digging.

TODO(after): fill After. Normalize by workload and name the confounders: the model and effort mix changed too.

On October 15 I also deleted about 173 GB of scratch folders left by finished tasks, so free disk in the After column reflects that cleanup as much as the fixes.

| Metric                                     | Before   | After       |
| ------------------------------------------ | -------- | ----------- |
| MCP server processes, busy moment (Oct 14) | 253      | TODO(after) |
| Swap, daily mean                           | 10.6 GiB | TODO(after) |
| Hours above 90% CPU per day                | 1.1      | TODO(after) |
| Free disk, lowest                          | 12.8 GiB | TODO(after) |
| Codex reviews per 1,000 commands           | 200      | TODO(after) |
| Codex requests escalated up front          | 84.6%    | TODO(after) |
| Claude Bash calls matched by allow rules   | 17%      | TODO(after) |
| Codex command p50, hours above 70% CPU     | 2.1 s    | TODO(after) |
| Main-thread time waiting on subagents      | 53%      | TODO(after) |

## The month that led here

This didn't come out of nowhere. In the four weeks before, I had been building the pieces to keep a fleet of agents in check on one machine:

- My machine config moved from nix-darwin to [zakwas](https://github.com/Automaat/zakwas), which now manages plugins, instructions, hooks and permissions for every agent.
- The global instructions loaded into every session went from 13.9 KB to 1.7 KB. The rest became a skill that loads on demand.
- `build-slot` lets only 3 heavy builds run at once. [reef](https://github.com/smykla-skalski/reef) records host pressure and can queue heavy commands. Sail caps concurrent jobs.
- [bilgie](https://github.com/smykla-skalski/bilgie) became an unattended disk janitor, triggered by free space.
- [klaudiush](https://github.com/smykla-skalski/klaudiush) hooks now block for real in Codex too. Before a fix, they never stopped a Codex tool call.
- Capping review rounds in my [ship-it skill](https://github.com/smykla-skalski/sai) took merged PRs from 3 in 15 hours to 14 in 7.

TODO(after): decide whether this section stays or becomes its own post.

## If you run many agents on one machine

- Count your MCP server processes: `ps -Ao command | grep -cE 'mcp'`. Make every server opt-in per agent or profile.
- Restart long-lived agent daemons now and then.
- Keep shared caches shared.
- Write commands your allowlists can match, and measure how many approvals you pay for.
- Watch how long parent agents wait on subagents.
- Record a baseline before you add guardrails, not after.

TODO(after): closing paragraph once the numbers are in.
