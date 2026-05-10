# MCP Deploy Policy

This repository uses MCP as the default deployment path.

## Team Rule

- Always prefer deployment via the connected MCP server.
- Always run deployment at the end of each completed change/task when deployment is relevant (without waiting for an extra reminder).
- Do not fall back to manual CLI deploy unless MCP is unavailable or explicitly requested.

## Required Behavior

1. Verify MCP connection is healthy.
2. Use MCP deploy flow for the target service/function.
3. Report deploy result (success/failure + short reason).
4. If MCP auth/session is invalid, reconnect MCP and retry.
5. If the user asks to "always deploy", treat it as a standing instruction for this repository.

## Supabase (Current Project)

- Default path: Supabase MCP tools.
- Typical target in this repo: `create-realtime-session` Edge Function.

## Notes

- This file is the canonical deploy preference reference.
- Keep it updated if deployment tooling changes.
