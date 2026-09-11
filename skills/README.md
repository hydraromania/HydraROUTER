# hydrarouter — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use hydrarouter for you.

> Tip: start with the **hydrarouter** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/decolua/hydrarouter/refs/heads/master/skills/hydrarouter/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export HYDRAROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export HYDRAROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $HYDRAROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/decolua/hydrarouter
- Dashboard: https://hydrarouter.com
