# LocalDub Git Collaboration Protocol

This document defines the mandatory workflow for developing and submitting contributions to the LocalDub project.

## Core Principle
**The `main` branch must always be a clean mirror of `upstream/main`.** 
Any feature development that happens on `main` (as a scratchpad) must be isolated and the `main` branch purified before a PR is submitted.

## Workflow: From Development to PR

### 1. The "Rapid Iteration" Phase
- Developers may write code directly on `main` or a temporary branch for speed.
- **Caveat**: This creates "commit accumulation" if not cleaned.

### 2. The "Clean-PR" Sequence (Mandatory)
When the user asks to "perform git flow" or "create PR", the agent must execute the following sequence:

1. **Isolate Feature**: 
   - Create a dedicated feature branch: `git checkout -b feat/feature-name`.
   - Ensure only the relevant changes for this specific feature are committed here.
2. **Purify Main**:
   - Switch to main: `git checkout main`.
   - Force sync with upstream: `git fetch upstream` $\rightarrow$ `git reset --hard upstream/main`.
   - Update fork: `git push myfork main -f`.
3. **Align Feature Branch**:
   - Switch back to feature branch: `git checkout feat/feature-name`.
   - Rebase onto the now-pure main: `git rebase upstream/main`.
   - Force push the cleaned feature branch: `git push myfork feat/feature-name -f`.
4. **Submit**:
   - Create PR: `gh pr create`.

## Commit Conventions
All commits must follow the Conventional Commits specification:
- `feat(scope):` New feature
- `fix(scope):` Bug fix
- `refactor(scope):` Code change that neither fixes a bug nor adds a feature
- `chore(scope):` Updating build scripts, package manager configs, etc.

## Common Troubleshooting
- **Commit Accumulation**: If a PR shows too many commits, it means the branch was based on a "dirty" `main`. Solution: `git rebase upstream/main`.
- **Merge Conflicts**: Resolve conflicts manually, then `git add .` $\rightarrow$ `git rebase --continue`.
