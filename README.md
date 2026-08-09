# pi-fireworks-quota

[![npm version](https://img.shields.io/npm/v/pi-fireworks-quota.svg)](https://www.npmjs.com/package/pi-fireworks-quota) [![npm downloads](https://img.shields.io/npm/dm/pi-fireworks-quota.svg)](https://www.npmjs.com/package/pi-fireworks-quota) [![license](https://img.shields.io/npm/l/pi-fireworks-quota.svg)](https://github.com/ZeR020/pi-fireworks-quota/blob/main/LICENSE)

`/fireworks:quota` + `/fireworks:test-key` — Fireworks AI balance/spend inside Pi.

## Install

From npm:

```bash
pi install npm:pi-fireworks-quota
```

From GitHub:

```bash
pi install git:github.com/ZeR020/pi-fireworks-quota
```

## Usage

```
/fireworks:quota
/fireworks:test-key
/fireworks:test-key fw_...
```

| Command | What it does |
| --- | --- |
| `/fireworks:quota` | Quota UI for the currently active Fireworks key |
| `/fireworks:test-key` | Prompt for (or take) another key and open the same UI — **does not switch** your active key |

| Tab | Content |
| --- | --- |
| Balance | Credits remaining and month spend against budget |
| Tokens | Month totals: prompt, completion, cached, uncached, cache hit |
| Models | Per-model tokens and spend; switch period with ←/→ |
| Account | Email, account ID, state, API-key tail, serverless RPM limit |

Keybindings:

- `Tab` / `Shift+Tab` — switch tabs
- `r` — refresh
- `q` / `Esc` — close
- `←` / `→` — change period on the Models tab

## Requirements

Fireworks auth must be configured in Pi, either in `auth.json` or via the `FIREWORKS_API_KEY` environment variable.

## Note

This package calls Fireworks' internal gRPC control-plane API, which may change without notice.
