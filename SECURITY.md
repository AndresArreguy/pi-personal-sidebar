# Security Policy

## Supported versions

Security fixes are provided for the latest released version. Please reproduce on
the latest tag before reporting.

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability**.
3. Include the affected version, operating system, Pi version, reproduction
   steps, impact, and any proof of concept.

If private reporting is unavailable, contact the maintainer through GitHub and
ask for a private channel. Please do not include secrets, API keys or account
data in the report.

## Scope

This extension runs with the same permissions as your Pi process. Areas of
interest include:

- Command injection or unsafe argument handling in the npm/pnpm cleanup action.
- Path traversal or arbitrary file access through project/state paths.
- Exposure of credentials or provider data in notifications, logs or the UI.
- Layout or editor code that could execute untrusted content.

## Out of scope

- Vulnerabilities in Pi itself: report them to
  [earendil-works/pi](https://github.com/earendil-works/pi/security).
- Vulnerabilities in `@juicesharp/rpiv-todo` or Command Code services: report them
  to their maintainers.
- Issues that require an already-compromised local account or a modified local
  package.

## Disclosure

We aim to acknowledge reports within a few days and to coordinate a fix and
disclosure date with the reporter. No bug bounty is offered.
