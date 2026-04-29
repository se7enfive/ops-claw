# Contributing to Server Chat

Thank you for your interest in contributing to Server Chat! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/se7enfive/ops-claw.git
cd ops-claw

# Install dependencies
npm install

# Start development server
npm run dev
```

## Project Structure

- `src/main/` - Electron main process (Node.js environment)
- `src/preload/` - IPC bridge between main and renderer
- `src/renderer/` - React frontend (browser environment)
- `docs/` - Design documentation

## Code Style

### TypeScript

- Use TypeScript for all code
- Follow existing naming conventions
- Use meaningful variable and function names
- Add type annotations where helpful

### React

- Use functional components with hooks
- Follow component structure in existing files
- Use TailwindCSS for styling (avoid inline styles)

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add SFTP file transfer support
fix: resolve SSH connection timeout issue
docs: update README with new features
refactor: simplify token budget logic
```

## Pull Request Process

1. **Fork** the repository and create your branch from `main`
2. **Make changes** following the code style guidelines
3. **Test** your changes thoroughly
4. **Update documentation** if needed
5. **Submit PR** with a clear description

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass (if applicable)
- [ ] Documentation updated
- [ ] No new warnings introduced
- [ ] Self-review completed

## Reporting Issues

### Bug Reports

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, version)
- Screenshots if helpful

### Feature Requests

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md) and include:

- Clear description of the feature
- Problem it solves
- Proposed solution
- Implementation ideas

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow

## Questions?

Feel free to open a [Discussion](https://github.com/se7enfive/ops-claw/discussions) for questions or ideas.

---

Thank you for contributing! 🎉
