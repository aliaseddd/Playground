# Claude Code — GitHub Operations Capability Assessment

**Date:** 2026-08-07
**Method:** Empirical probing of a live Claude Code session (Claude Code on the web, remote
execution environment) against `aliaseddd/stargazers-log`, plus review of current GitHub API
documentation.

Results were obtained by exercising real endpoints, not by reading documentation alone.
Non-mutating probe technique: send a syntactically invalid or non-existent-target request and
read the status code. `403` with an Anthropic `documentation_url` means a policy block; `422`
(validation) or `404` (no such target) means the path is authorized and only the request body
or target was wrong.

---

## 0. The headline finding: there are two different credential paths

This is the single most important thing to understand, and it is not documented in the session
prompt. Claude Code reaches GitHub through **two independent channels with materially different
permissions**:

| | Channel A — agent proxy | Channel B — GitHub MCP server |
|---|---|---|
| Used by | `Bash` + `curl`/`git` with `$GITHUB_TOKEN` | `mcp__github__*` tools |
| Credential | Session-scoped proxy token (prefix `prox…`, no OAuth scopes, 15k rate limit) | GitHub App installation token held server-side |
| Write policy | Narrow allowlist, enforced by the egress proxy | Full GitHub App installation permissions |

The proxy actively rejects writes that the MCP server performs successfully. Demonstrated:

```
# Channel A — blocked
POST /repos/{o}/{r}/git/refs
  → 403 "Write access to this GitHub API path is not permitted through this proxy."

# Channel B — same underlying endpoint, succeeded
mcp__github__create_branch → 201, ref created
```

**Consequence:** any capability assessment that tests only `curl`/`gh` will under-report what
Claude Code can do by a wide margin. Where the two disagree below, the MCP result is the real
capability.

A second consequence: `gh` **is not installed** in this environment (`gh: command not found`),
and GraphQL is almost entirely blocked (`403 — only the pinned set of PR-review operations is
served`). So of the four mechanisms in the original question, the practical ranking here is:
**MCP > direct REST (read-heavy) > git CLI > `gh` (absent) > GraphQL (blocked)**.

---

## 1. Capability matrix

Legend — **Yes** = works in this session; **Yes\*** = works, with a material caveat;
**Partial** = read only, or one mechanism of several; **No** = blocked or no mechanism exists.

| # | Operation | Verdict | Mechanism | Permission required | Material limitation |
|---|---|---|---|---|---|
| 1 | Repository file **read** | **Yes** | Local `Read`/`Grep` on the clone; `mcp__github__get_file_contents`; REST `GET /contents` | Contents: read | None. Three independent working paths. |
| 2 | Repository file **write** | **Yes** | `Write`/`Edit` + `git commit && git push`; or `mcp__github__create_or_update_file` / `push_files` | Contents: write | REST `PUT /contents` via the proxy is **blocked** (403). Use git or MCP. Updates via MCP need the blob SHA. |
| 3 | Branch creation | **Yes** | `git push -u origin <branch>`; `mcp__github__create_branch` | Contents: write | Creation only. **Branch *deletion* is blocked on both channels** (git → 403; REST `DELETE /git/refs` → 403). |
| 4 | Commits | **Yes** | Local `git commit` + push; `mcp__github__push_files` (multi-file, single commit) | Contents: write | Local git commits are unsigned unless signing is configured; MCP-authored commits are attributed to the App. |
| 5 | Issue create / update / close | **Yes** | `mcp__github__issue_write` (`create`/`update`); REST `POST/PATCH /issues` | Issues: write | Closing should set `state_reason` (`completed` / `not_planned` / `duplicate`). |
| 6 | Issue **parent/sub-issue** relationships | **Yes** | `mcp__github__sub_issue_write` (`add`/`remove`/`reprioritize`); REST `/issues/{n}/sub_issues` | Issues: write | Takes the sub-issue's **database ID, not its issue number** — a common failure. No writable "parent" field; re-parent via `add` with `replace_parent=true`. |
| 7 | Issue **blocking / blocked-by** dependencies | **Yes** | REST `/issues/{n}/dependencies/blocked_by` and `/dependencies/blocking` | Issues: write | **No MCP tool exists** — this is REST-only, and it is one of the few writes the proxy *does* allow (verified `422`, i.e. authorized). Body takes `issue_id` (database ID). |
| 8 | Issue labels | **Yes** | `mcp__github__issue_write` (`labels`); REST `/issues/{n}/labels`, `/labels` | Issues: write | Labels must exist or be created first. |
| 9 | Issue **types** | **Partial** | `mcp__github__list_issue_types`; `type` param on `issue_write` | Organization-level read/write | **Organization-only feature.** `aliaseddd` is a personal account, so unavailable on this repo (`/orgs/…/issue-types` → 403). Works only on org repos. |
| 10 | Issue **fields** (custom) | **Partial** | `mcp__github__list_issue_fields`; `issue_fields` param on `issue_write` | Organization-level | Same org-only constraint as issue types. Note: these are *Issue Fields*, a distinct feature from *Projects* custom fields (#12). |
| 11 | Issue comments | **Yes** | `mcp__github__add_issue_comment`; REST `POST /issues/{n}/comments` | Issues: write | House rule: every Claude-authored GitHub comment must carry the attribution footer. |
| 12 | **GitHub Projects** access | **No** | — | Projects: read/write (user- or org-scoped) | **Structurally blocked.** Projects live at `/users/…/projectsV2` and `/orgs/…/projectsV2`; the proxy rejects them: *"sessions are bound to their configured repositories."* GraphQL — the traditional Projects path — is also blocked. No MCP Projects tool exists. A REST API for Projects now exists (API version `2026-03-10`), so this is a **session-scoping limitation, not a GitHub limitation**. |
| 13 | Projects **custom-field** read/write | **No** | — | Projects: write | Same cause as #12. Endpoints (`…/projectsV2/{n}/fields`, `PATCH …/items/{id}`) exist upstream but are unreachable from a repo-bound session. |
| 14 | Pull-request creation / update | **Yes** | `mcp__github__create_pull_request` / `update_pull_request`; REST `POST/PATCH /pulls` | Pull requests: write | Check for a PR template before writing the body. Do not open a PR unless explicitly asked. |
| 15 | PR **diff** retrieval | **Yes** | `mcp__github__pull_request_read` (`get_diff`, `get_files`, `get_commits`) | Pull requests: read | Large diffs need pagination; prefer `get_files` with `perPage` over a raw whole diff. |
| 16 | Issue / PR linking | **Yes** | Closing keywords (`Closes #12`) in the PR body via `create_pull_request`; sub-issues (#6) for hierarchy | Pull requests: write | No dedicated "link" endpoint — linkage is a side effect of body keywords. Cross-repo linking requires the fully-qualified `owner/repo#n` form. |
| 17 | PR review / comment operations | **Yes** | `pull_request_review_write` (create → `add_comment_to_pending_review` → `submit_pending`), `add_reply_to_pull_request_comment`, `resolve_review_thread` | Pull requests: write | The pending-review handshake is required for line-level comments; a single-shot review cannot carry them. Thread resolve/unresolve are among the few GraphQL ops still permitted. |
| 18 | **Merge** operations | **Yes\*** | `mcp__github__merge_pull_request` (`merge`/`squash`/`rebase`) | Contents: write + Pull requests: write | **Channel-dependent, and the sharpest split found.** Raw REST is explicitly refused: *"Merging pull requests is not permitted for this session type."* The MCP tool reaches GitHub normally (probe returned `404` for a non-existent PR, not a policy denial). Also available: `enable_pr_auto_merge`. |
| 19 | **Tag creation** | **No** | — | Contents: write | **Blocked on every available path.** `git push origin <tag>` → `403`; REST `POST /git/refs` (`refs/tags/…`) → `403`; and the MCP server exposes only `get_tag`/`list_tags` — **no tag-creation tool exists**. Branch refs push fine, so this is a deliberate tag-namespace restriction. Reading tags works. |
| 20 | Protected-tag / ruleset **inspection** | **Partial** | REST `GET /rulesets`, `GET /rules/branches/{b}` (both verified `200`) | Administration: read | Inspection works; **configuration does not** — `POST /rulesets` → `403`. Legacy `/tags/protection` returns `404` (superseded by rulesets). No MCP tool for either. |
| 21 | Release creation (incl. immutable) | **No** | — | Contents: write; Administration: write for the immutability toggle | **Explicitly refused by policy:** *"Creating, editing, or deleting releases is not permitted for this session type."* No MCP release-write tool exists either (only `list_releases`, `get_latest_release`, `get_release_by_tag`). Compounding: releases need a tag, and tag creation is also blocked (#19). Immutable releases went GA Oct 2025 and are toggled via repo settings/REST — but repo-settings writes are blocked too (`PATCH /repos/{o}/{r}` → 403). **Reading releases works.** |
| 22 | Branch / ruleset protection config | **Partial (read), No (write)** | Rulesets readable per #20 | Administration: write | Legacy branch protection is unreadable here — `GET /branches/main/protection` → `403 "Resource not accessible by integration"` (a genuine GitHub App permission gap, *not* a proxy block — note the `docs.github.com` doc URL). Rulesets are the modern, readable equivalent. All protection writes blocked. |
| 23 | Required status-check inspection / config | **Partial** | Inspect via `GET /commits/{sha}/status` and `/check-runs` (both `200`); `pull_request_read` methods `get_status`, `get_check_runs` | Checks: read / Administration: write to configure | Observing *actual* check results works well. Reading or writing the *required-checks policy* does not — it sits behind branch protection (403) or rulesets write (403). |
| 24 | Actions **workflow file** create/edit | **Yes\*** | `Write`/`Edit` + `git push` of `.github/workflows/*.yml` — **verified by real push** | Contents: write **+ Workflows: write** | Verified empirically: a workflow file pushed cleanly. This is the classic failure mode elsewhere — a token lacking the `workflows` permission is rejected at receive-time with a message about workflow scope — but this session's credential carries it. Editing the file is *not* the same as running it. |
| 25 | Actions run / status retrieval | **Yes** | `mcp__github__actions_list`, `actions_get`, `get_job_logs`, `get_check_run`; REST `/actions/runs`, `/actions/workflows` (`200`) | Actions: read | Full read access. Log retrieval supports failed-job filtering. |
| 26 | Actions run **triggering** *(adjacent; included for completeness)* | **Yes\*** | `mcp__github__actions_run_trigger` (`run_workflow`, `rerun_*`, `cancel_*`) | Actions: write | Channel-split again: raw REST `dispatches` → `403 "Resource not accessible by integration"`; the MCP tool reaches GitHub (`404` on a non-existent workflow). |
| 27 | Issue Form / template creation via repo files | **Yes** | `Write` + `git push` of `.github/ISSUE_TEMPLATE/*.yml` and `config.yml` | Contents: write | Ordinary file writes — no special API. YAML schema errors surface only in GitHub's UI, so validate the form schema carefully before pushing. |
| 28 | PR-template creation | **Yes** | `Write` + `git push` of `.github/pull_request_template.md` (or `PULL_REQUEST_TEMPLATE/` for multiples) | Contents: write | Same as #27. Multiple templates are selectable only via `?template=` query parameter, not automatically. |

---

## 2. Summary by verdict

**Fully supported (16):** file read, file write, branch creation, commits, issue
create/update/close, sub-issues, issue dependencies, labels, comments, PR create/update, PR diff,
issue↔PR linking, PR review/comments, merge, Actions run retrieval, Actions triggering, workflow
file editing, issue forms, PR templates.

**Partial (5):** issue types and issue fields (org-only, unavailable on this personal-account
repo); ruleset inspection (read yes, write no); branch protection (rulesets readable, legacy
protection not, writes no); required status checks (results readable, policy not).

**Not supported (3):** GitHub Projects access, Projects custom fields, tag creation, release
creation. Of these, **only tag/release creation are policy choices about this session type** —
Projects is a *scoping* consequence of the session being bound to a single repository.

---

## 3. What generalizes beyond this session

Several limits above are properties of **this** session type (Claude Code on the web, repo-bound,
egress-proxied), not of Claude Code as a product:

- Tag creation, release creation, merging via REST, repo-settings writes, and Projects access are
  all blocked **by session policy**. A local Claude Code CLI run with a user PAT or `gh` auth has
  none of these restrictions, and `gh` would be present.
- Issue types / issue fields are unavailable here because the repo owner is a **personal account**;
  on an organization repo both work.
- Branch protection's `403 "Resource not accessible by integration"` is a **GitHub App permission
  gap** and would resolve with an installation granted `Administration: read`.

Conversely, some findings generalize everywhere: sub-issue and dependency APIs take **database
IDs, not issue numbers**; workflow-file pushes need a distinct **Workflows** permission beyond
Contents; and Projects requires **user/org-scoped** credentials that a repo-scoped token
structurally cannot carry.

---

## Sources

- [Immutable releases are now generally available — GitHub Changelog](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/)
- [Immutable releases — GitHub Docs](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [A REST API for GitHub Projects, sub-issues improvements, and more — GitHub Changelog](https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/)
- [REST API endpoints for Project fields — GitHub Docs](https://docs.github.com/en/rest/projects/fields)
- [REST API endpoints for issue dependencies — GitHub Docs](https://docs.github.com/en/rest/issues/issue-dependencies)
- [REST API endpoints for issue fields — GitHub Docs](https://docs.github.com/en/rest/orgs/issue-fields)
- [Claude Code on the web — documentation](https://code.claude.com/docs/en/claude-code-on-the-web)
