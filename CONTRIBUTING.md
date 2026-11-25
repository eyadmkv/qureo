# Contributing

Thanks for considering a contribution.

## Before opening an issue

- Search existing issues and pull requests.
- Include the exact command, expected behavior and actual behavior.
- Remove student IDs, cookies, passwords, database files and personal exports from logs.
- Include your Node.js version, PowerShell version and Windows version when relevant.

## Development setup

Requirements: Windows 10/11, PowerShell 7, Node.js 22.12 or newer.

```powershell
git clone https://github.com/eyadmkv/qureo.git
cd qureo
npm install
npm run check
```

For a local command installation:

```powershell
npm link
```

## Pull requests

- Keep changes focused and explain the reason for the change.
- Add or update tests for behavior changes.
- Run `npm run check` before submitting.
- Update documentation when commands, configuration or behavior change.
- Never commit `data/`, `exports/`, `.env` files, session cookies, student identifiers or personal answer archives.
- Do not add browser automation or bypass paywalls/access controls.
- Preserve sequential solver behavior and the safety invariants in `ROADMAP.md`.

## Reporting security issues

Do not publish credentials, session files or exploitable security details in a public issue. Follow [SECURITY.md](SECURITY.md).
