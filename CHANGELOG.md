# Changelog

All notable changes to VibeBoard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI workflow improvements: Node 18, 20, 22 matrix testing and smoke test
- CHANGELOG.md following Keep a Changelog format
- Test framework documentation in CONTRIBUTING.md

## [0.2.11] - 2026-05-31

### Added
- MCP tools pagination and filtering (`list_cards`, `search_cards` with `limit`/`offset`)
- Frontend UX and accessibility improvements

### Fixed
- Agent lifecycle: silent failures, timer leaks, and graceful shutdown
- Concurrency race conditions in board sync and agent respawn
- Database transaction safety and data integrity
- Configuration validation and token rotation
- Frontend bugs: SSE TypeError, stale sidebar state, search empty state

## [0.2.10] - 2026-05-30

### Added
- Agent context file viewer with markdown rendering
- Minimalist custom datepicker replacing native date input

### Fixed
- Null-guard card-activity-divider in open/close card modal

## [0.2.9] - 2026-05-29

### Added
- Group Agent+Model in sidebar-group unit, show prompt by default
- Show disabled reason hint for unavailable agents in dropdowns

### Fixed
- Card details sidebar layout and consistency
- New card modal layout and density
- Spacing and separator between Changes section and action buttons

## [0.2.8] - 2026-05-28

### Added
- Polish Agent tab: dropdown selector, better prompt UI
- Redesign new card modal: Priority and Agent dropdowns

### Fixed
- Blocked-by dropdown: filter Done cards, add column badge, fix z-index
- Diff expand icon in Agent tab
- Collapse all notes functionality
- ANSI escape codes and control characters in agent output display

### Changed
- Redesign Details tab: flat fields layout with inline labels
- Apply flat label redesign to new card modal
- Combine Priority and Due Date onto one row in Details tab

## [0.2.7] - 2026-05-27

### Changed
- Settings button and settings modal polish

## [0.2.6] - 2026-05-26

### Added
- Initial workspace and board management features

## [0.2.5] - 2026-05-25

### Added
- Core MCP integration features

## [0.2.4] - 2026-05-24

### Fixed
- Various stability improvements

## [0.2.3] - 2026-05-23

### Fixed
- Bug fixes and performance improvements

## [0.2.2] - 2026-05-22

### Fixed
- Critical bug fixes

## [0.2.1] - 2026-05-21

### Fixed
- Post-launch bug fixes

## [0.2.0] - 2026-05-20

### Added
- Major feature release with enhanced agent integration

## [0.1.0] - 2026-05-15

### Added
- Initial public release
- Basic kanban board functionality
- MCP integration for Claude Code, OpenCode, and Codex
- Git worktree isolation
- Agent spawning and lifecycle management
- SQLite database storage
- Light and dark themes

[Unreleased]: https://github.com/zanuartri/vibeboard/compare/v0.2.11...HEAD
[0.2.11]: https://github.com/zanuartri/vibeboard/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/zanuartri/vibeboard/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/zanuartri/vibeboard/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/zanuartri/vibeboard/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/zanuartri/vibeboard/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/zanuartri/vibeboard/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/zanuartri/vibeboard/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/zanuartri/vibeboard/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/zanuartri/vibeboard/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/zanuartri/vibeboard/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/zanuartri/vibeboard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zanuartri/vibeboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zanuartri/vibeboard/releases/tag/v0.1.0
