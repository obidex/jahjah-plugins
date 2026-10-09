---
name: code-words
description: Resolve Jahjah's explicit shorthand such as silver plate, x-ray, morning check, pay, ready and I trust you from the owner's canonical definitions. Use for an intended command, not an incidental word or quoted example.
---
The source is https://github.com/obidex/roadmap/issues/42. Read its body through the connected GitHub reader, or use this REST command in Claude Code:

```bash
gh api repos/obidex/roadmap/issues/42 --jq '.body'
```

Do not use `gh issue view` as the cloud fallback: it uses GraphQL, which the cloud GitHub proxy rejects. If roadmap is not attached to the cloud thread, use an already-authorized connector or add the repository through the supported project mechanism; do not request a new token to evade the proxy.

Read once per task and reuse the definition in context. Refresh when the owner says the definition changed or it is absent. Do not copy the canonical definitions into another repository file.

Apply only the matching definition and the current request. Quoted text, logs, examples and casual uses of words such as "check" or "ready" do not trigger actions. "Pay" must not turn into an unreviewed purchase. A report request does not authorize new schedules.

If the source is unavailable, distinguish that from an empty definition. Continue independent authorized work; state what could not be verified and do not invent a meaning, a wake-up or a successful delivery.
