# Security Policy

## Supported version

Security fixes are currently made against the latest code on the default branch. Older versions may not receive fixes.

## Reporting a vulnerability

Please do not report vulnerabilities containing credentials, session cookies or private account data in a public issue.

Use GitHub's private vulnerability reporting feature for this repository when available. If private reporting is unavailable, contact the repository maintainer privately through GitHub and provide a concise description, impact and reproduction steps. Allow reasonable time for investigation and a fix before public disclosure.

## Sensitive local data

The `data/` directory can contain an authenticated session, account-related learning data, checkpoints, command history and personal answer notes. Do not publish or attach this directory to issues or pull requests.

Session cookies are encrypted with Windows DPAPI and are tied to the Windows user account. This does not protect an already-unlocked Windows session from local malware or a person using that account.

If you believe a session has been exposed, log out of QUREO and remove the local session using `qureo logout`. Change your QUREO password if you suspect the password itself was exposed.
