# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-04-29

### Added

- Core SSH server management with chat-style interface
- AI natural language command generation
- Agent task decomposition system
- Command security analyzer with risk levels
- Permission modes (Standard/Cautious/Strict)
- Custom security rules support
- Token budget tracking
- Context compression with AI smart summary (Claude Code style)
- Session recovery after crash
- Multi-tab support for multiple servers
- Interactive terminal with xterm.js
- Dark/Light mode toggle
- Toast notification system
- AI config management UI (add/edit/delete)
- Password encryption with Electron safeStorage

### Security

- Dangerous command blocking (rm -rf /, mkfs, etc.)
- Password never stored in plain text
- Context isolation enabled
- No nodeIntegration in renderer