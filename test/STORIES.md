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

### US-3: "I want to see which plugins are available and their status"

**Command:** `agonda plugin list`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Read marketplace.json | `plugin.getMarketplace()` | `plugin.test.js` |
| 3 | Read enabledPlugins from settings (3 scopes) | `plugin.getEnabledPluginsWithScope()` | `plugin.test.js` |
| 4 | Cross-reference marketplace × settings | `plugin.listPlugins()` | `plugin.test.js` |
| 5 | Format as table or JSON | `commands/plugin.js` action | integration |

**Integration test:** `test/integration/plugin-management.test.js` — "list shows all plugins with status"

---

### US-4: "I want to validate my plugin before shipping"

**Command:** `agonda plugin validate`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Find workbench context (or all with --all) | `context.findWorkbenchContext()` / `context.findAllWorkbenches()` | `context.test.js` |
| 3 | Check plugin.json required fields | `validate.validateWorkbench()` | `validate.test.js` |
| 4 | Check for duplicate hook declarations | `validate.validateWorkbench()` | `validate.test.js` |
| 5 | Check SKILL.md existence + frontmatter | `validate.validateWorkbench()` | `validate.test.js` |
| 6 | Check hook script existence + rationale | `validate.validateWorkbench()` | `validate.test.js` |
| 7 | Check cross-workbench path references | `validate.validateWorkbench()` | `validate.test.js` |
| 8 | Report errors/warnings, exit 2 on errors | `commands/plugin.js` action | integration |

**Integration test:** `test/integration/plugin-validation.test.js` — "validate detects errors and returns exit code 2"

---

### US-5: "I want to switch to working on the website"

**Command:** `agonda plugin switch website-tools --keep governance-tools`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Resolve target plugin from marketplace | `plugin.findPlugin()` | `plugin.test.js` |
| 3 | Validate --keep plugins exist | `plugin.findPlugin()` | `plugin-manage.test.js` |
| 4 | Read current enabledPlugins from settings | `plugin.getSettingsPath()` + readSettings | `plugin-manage.test.js` |
| 5 | Disable all non-kept plugins | `plugin.switchPlugin()` | `plugin-manage.test.js` |
| 6 | Enable target plugin | `plugin.switchPlugin()` | `plugin-manage.test.js` |
| 7 | Write settings, warn about cache/restart | `commands/plugin.js` action | integration |

**Integration test:** `test/integration/plugin-management.test.js` — "switch disables others and enables target"

---

### US-6: "I want to enable governance-tools without affecting other plugins"

**Command:** `agonda plugin enable governance-tools`

| # | Agent Story | Lib Function | Unit Test |
|---|-------------|-------------|-----------|
| 1 | Find repo root | `context.findRepoRoot()` | `context.test.js` |
| 2 | Resolve plugin from marketplace | `plugin.findPlugin()` | `plugin.test.js` |
| 3 | Read settings for target scope | `plugin.getSettingsPath()` + readSettings | `plugin-manage.test.js` |
| 4 | Set enabled state, preserve other keys | `plugin.setPluginState()` | `plugin-manage.test.js` |
| 5 | Write settings, warn about restart | `commands/plugin.js` action | integration |

**Integration test:** `test/integration/plugin-management.test.js` — "enable sets state without affecting others"

## Running Tests

```bash
# All tests (unit + integration)
npm test

# Unit tests only
node --test test/*.test.js

# Integration tests only
node --test test/integration/
```
