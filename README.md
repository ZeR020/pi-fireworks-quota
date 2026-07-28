# pi-fireworks-quota

`/fireworks:quota` — Fireworks balance, month spend, tokens (incl. cached), and per-model $ for the active Pi key.

No `firectl`. Pure Node gRPC to `gateway.fireworks.ai`.

## Install

```bash
pi install /path/to/pi-fireworks-quota
cd /path/to/pi-fireworks-quota && npm install
```

Needs Fireworks auth in Pi (`auth.json` / `FIREWORKS_API_KEY`).

## Usage

```
/fireworks:quota
```

| Tab | Content |
| --- | --- |
| Balance | Credit remaining, month spend |
| Tokens | Month totals (compact) |
| Models | Per-model tokens + $ · ←/→ Today / Week / Month (lazy load) |
| Account | Email, key tail, RPM max |

`r` refresh · `q`/Esc close · Tab switch tabs

## Data sources (gRPC)

`ListAccounts` · `GetBalance` · `GetAccountUsage` · `GetBillingSummary` · `ListQuotas`

Internal control-plane API — can change without notice.
