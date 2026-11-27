# QStudy command

QStudy is an additive entry point over the existing QUREO and SPRIX CLIs. The `qstudy`, `qureo` and `sprix` executables are installed together. Existing service commands and their argument syntax remain available unchanged.

## Unified account

```powershell
qstudy login
qstudy status
qstudy logout
```

`qstudy login` asks for the shared student ID/Login ID and password once. It sends independent login requests to QUREO and SPRIX, saves each successful session in its existing encrypted format, and reports partial success if one platform rejects the credentials or is unavailable. The password is not saved.

The service sessions remain separate because QUREO and SPRIX issue different cookies and authenticate against different hosts. `qstudy logout` clears both session files but keeps local course data and captured study material.

The original login commands remain available:

```powershell
qureo login
sprix login
```

## Dashboard and synchronization

```powershell
qstudy dashboard
qstudy sync
qstudy dashboard
qstudy status
```

The dashboard reads the local QUREO database and the most recently synced SPRIX curriculum snapshot. It does not make network requests. `qstudy dashboard --refresh` refreshes both sources first. `qstudy status` performs read-only authentication checks against both services.

## Run existing commands

All existing commands can be used through the unified executable:

```powershell
qstudy qureo solve --dry-run
qstudy qureo questions 511021
qstudy sprix curriculum
qstudy sprix solve --dry-run
```

The standalone commands remain supported:

```powershell
qureo solve --dry-run
sprix solve --dry-run
```

## Package build

The package exposes `qstudy`, `qureo` and `sprix`. Inspect the npm package contents before publishing:

```powershell
npm pack --dry-run
```

The package allowlist includes application source and documentation. Local account sessions, databases, answer archives and exports are kept outside the package. Publishing to npm is a separate release step.

## Local data

On Windows, QStudy stores its runtime files under `%LOCALAPPDATA%\QStudy`. Existing source-checkout data under `data/`, local answer files under `answers/`, and the root `qureo.config.json` are copied to the new location when the application first starts.

Override the location with:

```powershell
$env:QSTUDY_DATA_DIR = "$HOME\QStudyData"
```
