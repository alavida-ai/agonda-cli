# User Stories → Agent Stories → Tests

Two-layer testing architecture for agonda-cli. User stories are acceptance criteria ("does this CLI solve the problem?"). Agent stories are the discrete steps the CLI performs — each maps to a lib function.

## Test Layers

| Layer | What | Location | Calls |
|-------|------|----------|-------|
| **Unit (agent stories)** | Individual lib functions | `test/*.test.js` | `src/lib/*.js` directly |
| **Integration (user stories)** | Full CLI workflows | `test/integration/*.test.js` | `bin/agonda.js` via child_process |

## User Stories

### US-1: "I want to see what workspaces exist and which workbench they belong to"

**Command:** `agonda workspace list`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Scan workspace/active/ for .workbench markers | `workspace.discoverWorkspaces()` | `workspace.test.js` |
| 3 | Parse marker files (workbench, domain, created) | `workspace.discoverWorkspaces()` | `workspace.test.js` |
| 4 | Format as table (TTY) or JSON (--json) | `commands/workspace.js` action | integration |

**Integration test:** `test/integration/workspace-discovery.test.js` — "list shows all workspaces"

---

### US-2: "I want to find the workspace for the architect workbench"

**Command:** `agonda workspace current <workbench-name>`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Discover all workspaces | `workspace.discoverWorkspaces()` | `workspace.test.js` |
| 3 | Filter by workbench name, return ALL matches | `workspace.findWorkspacesByWorkbench()` | `workspace.test.js` |
| 4 | Output path(s) or JSON | `commands/workspace.js` action | integration |

**Integration test:** `test/integration/workspace-discovery.test.js` — "current finds matching workspaces"

---

### US-3: "I want to see which workbenches are registered in the marketplace"

**Command:** `agonda marketplace list`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Read marketplace.json | `marketplace.getMarketplace()` | `marketplace.test.js` |
| 3 | Return workbench entries (no state) | `marketplace.listWorkbenches()` | `marketplace.test.js` |
| 4 | Format as table or JSON | `commands/marketplace.js` action | integration |

**Integration test:** `test/integration/marketplace-list.test.js` — "list shows all workbenches"

---

### US-4: "I want to validate my workbench before shipping"

**Command:** `agonda workbench validate`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Find workbench context (or all with --all) | `context.findWorkbenchContext()` / `context.findAllWorkbenches()` | `context.test.js` |
| 3 | Delegate to `claude plugin validate` for base checks | `validate.delegateToClaude()` | `validate.test.js` |
| 4 | Check SKILL.md existence + frontmatter | `validate.validateWorkbench()` | `validate.test.js` |
| 5 | Check hook script existence + rationale | `validate.validateWorkbench()` | `validate.test.js` |
| 6 | Check cross-workbench path references | `validate.validateWorkbench()` | `validate.test.js` |
| 7 | Check .mcp.json file references | `validate.validateWorkbench()` | `validate.test.js` |
| 8 | Report errors/warnings, exit 2 on errors | `commands/workbench.js` action | integration |

**Integration test:** `test/integration/workbench-validation.test.js` — "validate detects errors and returns exit code 2"

---

### US-7: "I want to validate the entire marketplace"

**Command:** `agonda marketplace validate`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Read marketplace.json | `marketplace.getMarketplace()` | `marketplace.test.js` |
| 3 | Resolve each plugin source path | `validate.validateMarketplace()` | `validate-marketplace.test.js` |
| 4 | Run per-workbench validation on each | `validate.validateWorkbench()` | `validate-marketplace.test.js` |
| 5 | Report cascade results | `commands/marketplace.js` action | integration |

**Integration test:** (inline in `validate-marketplace.test.js` for now)

---

### Removed Stories

US-5 ("switch to website") and US-6 ("enable governance-tools") were removed. Plugin state management (enable/disable/switch) is now handled natively by `claude plugin enable/disable --scope project`.

## Running Tests

```bash
# All tests (unit + integration)
npm test

# Unit tests only
node --test test/*.test.js

# Integration tests only
node --test test/integration/
```
