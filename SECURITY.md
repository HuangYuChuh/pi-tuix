# Security Policy

## Supported versions

Pi-TUIX is in early development. Security fixes currently target the latest code on the `main` branch until the first stable release defines a longer support window.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use GitHub's private vulnerability reporting or Security Advisory flow for this repository.

Include the affected version or commit, supported reproduction steps, impact, and any suggested mitigation. Do not include real credentials, private session data, or unrelated user files in the report.

## Security boundary

Pi-TUIX is a presentation extension. Pi remains responsible for provider authentication, project trust, tool permissions, tool execution, and session persistence. A Pi-TUIX renderer must not weaken or bypass those controls.
