# pi-fireworks-quota

`/fireworks:quota` — Fireworks AI balance, spend, tokens, and limits inside Pi.

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
```

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
