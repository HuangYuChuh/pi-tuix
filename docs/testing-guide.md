# Testing Guide for Compact TUI Enhancements

## Quick Start

Pi-TUIX is a pure TypeScript extension that runs directly in Pi without a build step.

### 1. Install as Local Extension

```bash
# From the pi-tuix directory
pi extension add .
```

Or specify the full path:
```bash
pi extension add C:\AI_Project\pi-tuix
```

### 2. Verify Installation

```bash
pi extension list
```

You should see `pi-tuix` in the list of installed extensions.

### 3. Start a Session

```bash
pi
```

Pi-TUIX will automatically activate when you start a TUI session.

## Testing Scenarios

### Scenario 1: Default Preview Mode

**Test:** Verify that tools default to preview mode with 4 lines

```
You: read the first 10 lines of package.json

Expected:
✅ Tool shows in preview mode
✅ Header line shows: READ package.json [OK] 10 lines
✅ Shows first 2 lines
✅ Shows "... N more lines hidden (use /pituix-mode expanded)"
✅ Shows last 2 lines
```

### Scenario 2: Error Auto-Expansion

**Test:** Errors automatically expand from collapsed to preview

```
You: read nonexistent-file.txt

Expected:
✅ Error is immediately visible (not collapsed)
✅ Red vertical bar prefix: ▌ READ nonexistent-file.txt [ERROR]
✅ Shows error message in preview
✅ Status includes "⚠ ATTENTION"
```

### Scenario 3: Mode Switching

**Test:** Manual mode control works correctly

```
You: /pituix-mode collapsed
You: read package.json

Expected:
✅ Shows single line: READ package.json [OK] N lines

You: /pituix-mode expanded
You: read package.json

Expected:
✅ Shows all content (no truncation)
✅ No hidden line indicators

You: /pituix-mode preview
(back to default behavior)
```

### Scenario 4: Configuration Persistence

**Test:** Settings are saved and loaded

```
You: /pituix-settings
# (Opens settings UI)
# Change maxPreviewLines to 6

Restart Pi session

You: read some-file.txt

Expected:
✅ Preview now shows 6 lines (3 head + 3 tail)
✅ Configuration persisted in ~/.agents/pi-tuix.json
```

### Scenario 5: Bash Tool Rendering

**Test:** Command output is properly summarized

```
You: run npm test

Expected:
✅ While running: BASH npm test [RUNNING] N output lines
✅ On success: BASH npm test [OK] N output lines
✅ On failure: ▌ BASH npm test [ERROR] ... error message ...
✅ Shows preview of output
```

### Scenario 6: Edit Tool with Diff Stats

**Test:** Edit operations show meaningful statistics

```
You: replace "foo" with "bar" in src/index.ts

Expected:
✅ Shows: EDIT src/index.ts [OK] +N -M
✅ Preview shows the diff
✅ Color-coded: green for additions, red for removals
```

### Scenario 7: Write Tool Line Count

**Test:** Write operations show content size

```
You: write "hello\nworld" to test.txt

Expected:
✅ Call shows: WRITE test.txt [QUEUED] 2 lines
✅ Result shows: WRITE test.txt [OK] 2 lines written
✅ Preview mode shows the written content
```

### Scenario 8: Narrow Terminal Handling

**Test:** Layout works at minimum width (24 chars)

```bash
# Resize terminal to ~30 columns
pi

You: read README.md

Expected:
✅ No horizontal overflow
✅ Paths are truncated with ...
✅ Status badges remain readable
✅ Preview content wraps correctly
```

### Scenario 9: Error Highlighting Toggle

**Test:** Error highlighting can be disabled

Edit `~/.agents/pi-tuix.json`:
```json
{
  "toolRender": {
    "highlightErrors": false
  }
}
```

Restart Pi and trigger an error:

Expected:
✅ No red vertical bar prefix
✅ Error still shown in preview
✅ Still marked as [ERROR] in status

### Scenario 10: Auto-Expand Toggle

**Test:** Auto-expand can be disabled

Edit `~/.agents/pi-tuix.json`:
```json
{
  "toolRender": {
    "autoExpand": false
  }
}
```

Restart Pi and trigger an error with mode set to collapsed:

Expected:
✅ Error stays collapsed (single line)
✅ Still shows error status and attention marker
✅ Manual expansion still works

## Verification Checklist

After testing, verify:

- [ ] All tool types render correctly (read, bash, edit, write)
- [ ] Error states are immediately visible
- [ ] Mode switching works without requiring restarts
- [ ] Configuration persists across sessions
- [ ] No TypeScript errors in terminal output
- [ ] No regression in tool execution behavior
- [ ] Performance is acceptable (no visible lag)
- [ ] Works with both Unicode and ASCII icon modes

## Debugging

### Enable Verbose Logging

```bash
# Check Pi logs for extension errors
tail -f ~/.pi/logs/latest.log | grep -i tuix
```

### Verify Extension Loading

```bash
pi extension list
```

Should show:
```
pi-tuix (C:\AI_Project\pi-tuix)
```

### Check Configuration File

```bash
cat ~/.agents/pi-tuix.json
```

Should contain:
```json
{
  "toolRender": {
    "defaultMode": "preview",
    "autoExpand": true,
    "maxPreviewLines": 4,
    "highlightErrors": true
  }
}
```

### Reset to Defaults

```bash
# Remove configuration file
rm ~/.agents/pi-tuix.json

# Restart Pi - defaults will be applied
```

### Revert to Pi Default Renderer

```bash
# In a Pi session
/pituix-default

# Pi-TUIX components are removed
# Original Pi rendering restored
```

## Known Limitations (Current MVP)

1. **Keyboard Shortcuts:** E/C keys not yet implemented for expand/collapse
2. **Per-Tool Preferences:** Cannot set different modes per tool type
3. **Smart Preview:** Always shows head+tail, not error-context-only
4. **Live Adjustment:** Cannot change maxPreviewLines without restart

These are planned for Phase 2 and Phase 3.

## Reporting Issues

When reporting issues, include:

1. Pi version: `pi --version`
2. Extension version: Check `package.json`
3. Configuration: `cat ~/.agents/pi-tuix.json`
4. Terminal size: `tput cols` and `tput lines`
5. Minimal reproduction steps
6. Expected vs actual behavior

## Next Steps

Once manual testing is complete, we can:

1. Create integration test scenarios
2. Add screenshot/recording comparisons
3. Write a user migration guide
4. Prepare release notes for 0.2.0

Happy testing! 🧪
