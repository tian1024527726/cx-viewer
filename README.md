# CC-Viewer

A Claude Code request monitoring system that captures and visualizes all API requests and responses from Claude Code in real time (raw text, unredacted). Helps developers monitor their context for review and troubleshooting during Vibe Coding sessions.
The latest version of CC-Viewer also provides a server-deployed web programming solution and mobile programming tools. Feel free to use them in your own projects — more plugin features and cloud deployment support are coming in the future.

Check out the fun part — here's what you can see on mobile:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

<font color="#999">(Current version has limited iOS compatibility — iOS optimization is planned for 2026.04.01)</font>

English | [简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

### Installation

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Programming Mode

ccv is a drop-in replacement for claude — all arguments are passed through to claude while launching the Web Viewer.

```bash
ccv                    # == claude (interactive mode)
ccv -c                 # == claude --continue (continue last conversation)
ccv -r                 # == claude --resume (resume a conversation)
ccv -p "hello"         # == claude --print "hello" (print mode)
ccv --d                # == claude --dangerously-skip-permissions (shortcut)
ccv --model opus       # == claude --model opus
```

After launching, a web page will open automatically.

You can use Claude directly from the web page while viewing the full request payloads and code changes.

Even better — you can even code from your mobile device!

### Logger Mode

⚠️ If you still prefer using the native claude tool or VS Code extension, use this mode.

In this mode, launching `claude` or `claude --dangerously-skip-permissions` will automatically start a logging process that records request logs to ~/.claude/cc-viewer/*yourproject*/date.jsonl

Enable logger mode:

```bash
ccv -logger
```

When the console cannot print the specific port, the default first port is 127.0.0.1:7008. Multiple instances use sequential ports like 7009, 7010.

This command automatically detects how Claude Code is installed locally (NPM or Native Install) and adapts accordingly.

- **NPM version Claude Code**: Automatically injects an interceptor script into Claude Code's `cli.js`.
- **Native version Claude Code**: Automatically detects the `claude` binary, configures a local transparent proxy, and sets up a Zsh Shell Hook to forward traffic automatically.
- NPM-installed Claude Code is the recommended approach for this project.

Uninstall logger mode:

```bash
ccv --uninstall
```

### Configuration Override

If you need to use a custom API endpoint (e.g., a corporate proxy), simply configure it in `~/.claude/settings.json` or set the `ANTHROPIC_BASE_URL` environment variable. `ccv` will automatically detect and correctly forward requests.

### Environment Variables

- `CCV_LOG_DIR`: Override the default log directory (`~/.claude/cc-viewer`).
  - Set to `tmp` to use the system temporary directory (useful for testing or ephemeral sessions).
  - Set to any absolute path or `~/path` to customize storage location.
- `CCV_DEBUG_PLUGINS`: Set to `1` to enable debug logs for the plugin system.

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, keeping your terminal output clean and consistent with the native experience. All logs are captured in the background and can be viewed at `http://localhost:7008`.

Once configured, use the `claude` command as normal. Visit `http://localhost:7008` to access the monitoring interface.

### Troubleshooting

If you encounter issues starting cc-viewer, here is the ultimate troubleshooting approach:

Step 1: Open Claude Code in any directory.

Step 2: Give Claude Code the following instruction:

```
I have installed the cc-viewer npm package, but after running ccv it still doesn't work properly. Please check cc-viewer's cli.js and findcc.js, and adapt them to the local Claude Code deployment based on the specific environment. Keep the scope of changes as constrained as possible within findcc.js.
```

Letting Claude Code diagnose the issue itself is more effective than asking anyone or reading any documentation!

After the above instruction is completed, `findcc.js` will be updated. If your project frequently requires local deployment, or if forked code often needs to resolve installation issues, keeping this file lets you simply copy it next time. At this stage, many projects and companies using Claude Code are not deploying on Mac but rather on server-side hosted environments, so the author has separated `findcc.js` to make it easier to track cc-viewer source code updates going forward.

### Other Commands

See:

```bash
ccv -h
```

### Configuration Override

If you need to use a custom API endpoint (e.g., a corporate proxy), simply configure it in `~/.claude/settings.json` or set the `ANTHROPIC_BASE_URL` environment variable. `ccv` will automatically detect and correctly forward requests.

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, keeping your terminal output clean and consistent with the native experience. All logs are captured in the background and can be viewed at `http://localhost:7008`.

Once configured, use the `claude` command as normal. Visit `http://localhost:7008` to access the monitoring interface.

## Features

### Programming Mode

After launching with ccv, you can see:

<img width="1500" height="725" alt="image" src="https://github.com/user-attachments/assets/a64a381e-5a68-430c-b594-6d57dc01f4d3" />

You can view code diffs directly after editing:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

While you can open files and code manually, manual coding is not recommended — that's old-school coding!

### Mobile Programming

You can even scan a QR code to code from your mobile device:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Fulfill your imagination of mobile programming. There's also a plugin mechanism — if you need to customize for your coding habits, stay tuned for plugin hooks updates.

### Logger Mode (View Complete Claude Code Sessions)

<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />

- Captures all API requests from Claude Code in real time, ensuring raw text — not redacted logs (this is important!!!)
- Automatically identifies and labels Main Agent and Sub Agent requests (subtypes: Plan, Search, Bash)
- MainAgent requests support Body Diff JSON, showing collapsed differences from the previous MainAgent request (only changed/new fields)
- Each request displays inline Token usage statistics (input/output tokens, cache creation/read, hit rate)
- Compatible with Claude Code Router (CCR) and other proxy scenarios — falls back to API path pattern matching

### Conversation Mode

Click the "Conversation Mode" button in the top-right corner to parse the Main Agent's complete conversation history into a chat interface:

<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />

- Agent Team display is not yet supported
- User messages are right-aligned (blue bubbles), Main Agent replies are left-aligned (dark bubbles)
- `thinking` blocks are collapsed by default, rendered as Markdown — click to expand and view the thinking process; one-click translation is supported (feature is still unstable)
- User selection messages (AskUserQuestion) are displayed in Q&A format
- Bidirectional mode sync: switching to conversation mode auto-scrolls to the conversation corresponding to the selected request; switching back to raw mode auto-scrolls to the selected request
- Settings panel: toggle default collapse state for tool results and thinking blocks
- Mobile conversation browsing: in mobile CLI mode, tap the "Conversation Browse" button in the top bar to slide out a read-only conversation view for browsing the complete conversation history on mobile

### Statistics Tool

The "Data Statistics" floating panel in the header area:

<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Displays cache creation/read counts and cache hit rate
- Cache rebuild statistics: grouped by reason (TTL, system/tools/model changes, message truncation/modification, key changes) showing counts and cache_creation tokens
- Tool usage statistics: displays call frequency for each tool sorted by number of calls
- Skill usage statistics: displays call frequency for each skill sorted by number of calls
- Concept help (?) icon: click to view built-in documentation for MainAgent, CacheRebuild, and each tool

### Log Management

Via the CC-Viewer dropdown menu in the top-left corner:

<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Import local logs: browse historical log files grouped by project, open in a new window
- Load local JSONL file: directly select a local `.jsonl` file to load and view (supports up to 500MB)
- Save current log as: download the current monitoring JSONL log file
- Merge logs: combine multiple JSONL log files into a single session for unified analysis
- View user Prompts: extract and display all user inputs, supporting three view modes — Raw mode (original content), Context mode (system tags collapsible), Text mode (plain text); slash commands (`/model`, `/context`, etc.) shown as standalone entries; command-related tags are auto-hidden from Prompt content
- Export Prompts to TXT: export user Prompts (plain text, excluding system tags) to a local `.txt` file

### Auto-Update

CC-Viewer automatically checks for updates on startup (at most once every 4 hours). Within the same major version (e.g., 1.x.x → 1.y.z), updates are applied automatically and take effect on the next restart. Cross-major-version updates only show a notification.

Auto-update follows Claude Code's global configuration in `~/.claude/settings.json`. If Claude Code has auto-updates disabled (`autoUpdates: false`), CC-Viewer will also skip auto-updates.

### Multi-language Support

CC-Viewer supports 18 languages, automatically switching based on system locale:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
