# Engineering Infrastructure

## Code Quality

### Biome
- **Formatter & Linter**: Single tool for code formatting and linting
- **Configuration**: `biome.json` (migrated to schema 2.5.10)
- **Commands**:
  - `npm run lint` - Check code quality
  - `npm run lint:fix` - Auto-fix issues
  - `npm run format` - Format code

### TypeScript
- **Type checking**: `npm run typecheck`
- **Configuration**: `tsconfig.json`

### Testing
- **Framework**: Node.js native test runner (`node --test`)
- **Command**: `npm test`
- **Coverage**: `npm run test:coverage` (generates HTML report in `coverage/`)
- **Watch mode**: `npm run test:watch`
- **Location**: `test/**/*.test.ts`

**Current coverage baseline:**
- Overall: ~63% statements
- High coverage: `plan.ts` (98%), `editor.ts` (100%), `workflow-status.ts` (98%)
- Needs improvement: `three-layer-view.ts` (20%), `renderers-v2.ts` (35%)

## CI/CD

### GitHub Actions

#### CI Workflow (`.github/workflows/ci.yml`)
Runs on push to `main` and pull requests:
1. Install dependencies
2. Type check
3. Lint
4. Test
5. Build check

#### Publish Workflow (`.github/workflows/publish.yml`)
Manual trigger for npm publishing:
```bash
gh workflow run publish.yml --ref main
```

Requirements:
- Clean working tree on `main`
- Version in `package.json` must be updated
- `NPM_TOKEN` secret configured in GitHub
- Run `npm run release:check -- --tag v<version> --channel latest` before triggering

## Development Workflow

### Pre-commit checks
```bash
npm run check  # typecheck + lint
npm test       # run tests
```

### Before committing
```bash
npm run format      # format code
npm run check       # verify quality
npm test            # verify tests
```

### Release Process
1. Update version in `package.json`
2. Run `npm run release:check -- --tag v<version> --channel latest`
3. Commit and push to `main`
4. Create git tag: `git tag v<version>`
5. Push tag: `git push origin v<version>`
6. Trigger publish workflow: `gh workflow run publish.yml --ref main`
7. Create GitHub Release from the tag

## Package Scripts

- `npm run typecheck` - Type check with TypeScript
- `npm run lint` - Check code with Biome
- `npm run lint:fix` - Auto-fix Biome issues
- `npm run format` - Format code with Biome
- `npm run check` - Run typecheck + lint
- `npm test` - Run test suite
- `npm run pack:check` - Verify package contents
- `npm run release:check` - Pre-release verification

## Philosophy

- **Simple tools**: Biome over multiple tools (Prettier + ESLint)
- **Manual releases**: Controlled publishing over automation
- **Native testing**: Node.js test runner over heavyweight frameworks
- **Fast feedback**: Quick local checks before CI
