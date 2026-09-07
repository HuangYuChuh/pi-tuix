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

### Scenario 11: Markdown Presentation Across Surfaces

**Test:** Send or replay a fixture containing a heading, a TypeScript fenced block,
a table, a blockquote, nested lists, Chinese text and emoji. Check widths 24, 40,
80 and 100 in both regular and fullscreen modes, then open `/pituix-transcript`
and the same saved session through `/pituix-resume` preview.

Expected:
- Code fence delimiters are hidden and code starts at the assistant body column.
- Table header text is centered within the same columns used by its data rows.
- Quote text is italic beside a visible quote rail.
- CJK, emoji, ANSI syntax colors and long table cells stay within terminal width.
- Live, transcript and resume-preview message bodies agree at each width.
- `/pituix-default` restores Pi's native Markdown presentation; `/pituix` reapplies the adapter.

Record the terminal name/version, Pi version, renderer mode, dimensions and a
plain-text or screenshot capture for the issue evidence.

### Scenario 12: Runtime Theme Synchronization

**Test:** Enable Pi-TUIX, switch the Pi theme from `/settings` while the shell is
active, and return to the conversation without restarting Pi. Repeat after
`/new`, `/resume`, or `/reload` if those commands are part of the target Pi
version's workflow.

Expected:
- Header, footer, editor chrome and live transcript use the newly selected theme.
- The editor draft and focus remain intact while the custom components are rebound.
- `/pituix-default` stops synchronization and restores native components.
- No theme preference is silently rewritten by the synchronization fallback.

Record the original and selected theme names, Pi version, renderer mode, terminal
dimensions and any visible delay before the new colors appear.

### Scenario 13: Native transcript selection and copy

**Test:** Verify copying a decorated multi-line response in fullscreen mode

1. Start Pi-TUIX in fullscreen mode with a terminal that supports mouse selection.
2. Send or display a disposable response containing a user prompt, a fenced code
   block, a table, CJK text, emoji, and a local attachment link.
3. Drag from the first user row through the final assistant row, including a
   wrapped line when the terminal is narrow.
4. Paste into a plain-text editor.

Expected:

✅ User and assistant text is copied in visible reading order
✅ Prompt markers and assistant markers do not add duplicated text
✅ Code and table rows remain present, including CJK and emoji characters
✅ OSC 8 attachment links remain clickable in the terminal and do not add URL
   escape sequences to copied text
✅ Copied text contains no ANSI SGR controls, OSC sequences, or BEL characters
✅ Selection still works after resizing between normal and narrow widths
✅ Regular mode keeps native terminal selection behavior; fullscreen mode uses
   Pi's public selection and clipboard callbacks

The automated regression is in `test/live-transcript.test.ts`. It drives the
public SGR mouse input path and `TuiAltScreen.copyActiveSelectionToClipboard()`;
it does not replace Pi's viewport or clipboard implementation.

For actual-terminal evidence, record the terminal name/version, Pi version,
mode, terminal dimensions, the fixture text, and the pasted output. Do not use
real credentials, private files, or production attachment URLs.

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
- [ ] Markdown treatment agrees across live, transcript and resume preview
- [ ] Markdown remains bounded at 24, 40, 80 and 100 columns
- [ ] `/pituix-default` restores native Markdown rendering
- [ ] Runtime theme changes rebind Pi-TUIX components while enabled
- [ ] Theme synchronization stops after `/pituix-default` and session shutdown

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
