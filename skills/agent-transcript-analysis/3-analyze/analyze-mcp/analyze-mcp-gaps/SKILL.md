---
name: analyze-mcp-gaps
description: >
  Within a transcript segment, identify MCP servers / tools that don't exist
  yet but should — moments where the agent could not close a loop because
  the relevant external system was unreachable from inside the session. Most
  often surfaced when the user tried to write a one-shot prompt and could
  not, or when the agent hand-rolled a brittle CLI workaround. Outputs
  proposals for new MCP servers or new tools on existing servers.
user-invocable: false
---

# Analyze MCP gaps

Per-segment analyzer. The "what's missing" analyzer for MCP servers. Companion to `analyze-mcp-trigger-performance` (which works on tools that *do* exist).

## Inputs

- `segment_messages`: the full segment
- `available_mcp_tools`: existing tools (so we don't re-propose them)
- `philosophy_mcp`: `references/philosophy-on-mcp.md`

## Output

```json
{
  "proposals": [
    {
      "kind": "new_server" | "new_tool_on_existing_server",
      "server": "<existing or proposed server name>",
      "tool": "<proposed tool name, if applicable>",
      "rationale": "<which heuristic this addresses — most often 'foreseeable closed-loop limitation' or 'agent hand-rolled a CLI'>",
      "evidence_turns": [N, M],
      "interface_sketch": {
        "inputs": "...",
        "output": "...",
        "auth": "<how the server would authenticate; consider what the team already runs>"
      },
      "alternative": "<could this be a Skill wrapping an existing CLI instead? — see philosophy doc>"
    }
  ]
}
```

## Sequencing checklist

- [ ] Look for moments where the agent reached for an external system the hard way:
  - Shelling out to `curl` / a CLI that needed credentials it didn't have
  - Asking the user to paste in data the agent could have pulled itself
  - Giving up on a step because "I don't have access to X"
- [ ] Look for moments where the user **could not write a closed-loop prompt** because of an external dependency — staging env, a prod log, a JIRA ticket, a Linear issue, a deployment system
- [ ] For each gap, decide: **new server** or **new tool on an existing server**? Reuse beats proliferation
- [ ] Sketch the interface — names, inputs, outputs, auth model
- [ ] Always evaluate the **alternative**: could a Skill that wraps an existing CLI accomplish this instead? An MCP server is the right answer when credentials, response-shape, or persistent connection make the CLI alternative brittle — the philosophy doc is the source of truth for this call

## Notes

- A common pattern from the team's playbook: closing a closed-loop gap usually requires **both** an MCP server *and* a Skill that orchestrates it. If you propose an MCP server here, also expect `analyze-skill-gaps` to propose a companion Skill.
- It's fine to produce zero proposals for a clean segment.
