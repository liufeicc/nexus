# Nexus

**Nexus** - Terminal Views

**[Official Website](https://liufeicc.github.io/nexus/)** | **[Download v1.0.0](https://github.com/liufeicc/nexus/releases/tag/v1.0.0)**

A desktop AI-powered intelligent workbench built with Electron. Nexus deeply integrates terminal command line, file browser, and web browser with AI agents, providing a one-stop intelligent working environment.

The software features an innovative three-panel layout and Dynamic Island interaction design, supporting multiple parallel sessions with SQLite-based state persistence to ensure your work progress is always recoverable.

## Features

- **Multi-session Management**: Create and switch between multiple independent work sessions
- **Three-panel System**: Terminal, File Browser, and Web Browser panels in any combination
- **AI Agent**: Built-in AI agent with natural language interaction, tool calling, and task execution
- **Dynamic Island**: Floating AI interaction interface inspired by Apple Dynamic Island
- **Tree-based Layout**: Panels support horizontal/vertical splits with draggable resizing
- **Theme System**: 6 carefully designed color themes
- **i18n Support**: Chinese, English, French, Spanish
- **Persistent Storage**: SQLite database for sessions, configurations, and history

## Requirements

| Item | Requirement |
|------|-------------|
| OS | Windows 10+ / Linux (Ubuntu 20.04+) / macOS 12+ |
| Processor | x86_64 or ARM64 |
| Memory | 4 GB or more |
| Disk Space | 500 MB available |
| Network | Internet connection required (for AI features) |

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Terminal Rendering**: xterm.js
- **PTY Support**: node-pty
- **State Management**: Zustand
- **Data Storage**: better-sqlite3
- **Build Tool**: Vite

## Installation

Download the latest version for your platform:

| Platform | Download | Size |
|----------|----------|------|
| Windows | [Nexus-1.0.0-setup.exe](https://github.com/liufeicc/nexus/releases/download/v1.0.0/Nexus-1.0.0-setup.exe) | 112 MB |
| Linux (Debian/Ubuntu) | [Nexus-1.0.0.deb](https://github.com/liufeicc/nexus/releases/download/v1.0.0/Nexus-1.0.0.deb) | 98 MB |
| Linux (Portable) | [Nexus-1.0.0.AppImage](https://github.com/liufeicc/nexus/releases/download/v1.0.0/Nexus-1.0.0.AppImage) | 120 MB |

### Quick Install

**Windows:**
Download and run `Nexus-1.0.0-setup.exe`, follow the installation wizard.

**Linux (Debian/Ubuntu):**
```bash
wget https://github.com/liufeicc/nexus/releases/download/v1.0.0/Nexus-1.0.0.deb
sudo dpkg -i Nexus-1.0.0.deb
```

**Linux (AppImage - portable):**
```bash
wget https://github.com/liufeicc/nexus/releases/download/v1.0.0/Nexus-1.0.0.AppImage
chmod +x Nexus-1.0.0.AppImage
./Nexus-1.0.0.AppImage
```

For other platforms, see [Releases](https://github.com/liufeicc/nexus/releases).

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Build for Linux
npm run build:linux

# Build for Windows
npm run build:win
```

## Quick Start

### First Launch

On first launch, an onboarding wizard guides you through:

1. **Welcome**: Software logo and introduction
2. **Model Configuration**: Configure AI model connection (Provider, API URL, API Key, Model Name)
3. **Connection Test**: Verify the model connection works

You can skip the configuration and set it up later in Settings.

### UI Overview

The main interface consists of:

1. **Header**: Logo, New Session button, Theme switcher, Settings, Help
2. **Sidebar**: Session management (resizable 160-400px, collapsible)
3. **Workspace**: Displays terminal, file browser, or browser panels
4. **Toolbar**: Panel split, create, and close operations
5. **Status Bar**: Rotating tips and status information

## Panels

### Terminal Panel

Full-featured terminal based on xterm.js with node-pty backend:

- Complete shell support (autocomplete, pipes, background jobs)
- Auto-resize with window changes
- Copy/paste with right-click menu or keyboard shortcuts
- Data channel connection for AI agent access

### File Browser Panel

Graphical file management:

- Breadcrumb navigation for quick directory jumping
- Grid view (90x90px cards) and List view
- File search (Ctrl+F) with highlighting
- Built-in viewers for: text files, images, PDF, Word (.docx), Excel (.xlsx), PowerPoint
- File operations: copy, cut, paste, delete, rename, create folder/file
- Data channel connection for AI agent access

### Browser Panel

Full web browsing based on Electron WebContentsView:

- Multi-tab browsing with drag-to-reorder
- Navigation: back, forward, refresh, stop
- URL autocomplete and bookmarks management
- Loading progress indicator
- Browser track connection for AI agent control

## Dynamic Island

A floating AI interaction window independent of the main window:

- **Collapsed state**: Minimal "NEXUS" badge with pulse ring
- **Expanded state**: Full AI chat interface with input, tools, and content area
- **Tools**: Task templates, Skills, Image attachments
- **Context management**: Real-time context usage indicator, clear/compress history
- **File attachments**: Drag-and-drop or button to attach files to messages
- **Sub-panels**: Task Panel, Skill Panel, Memory Panel

## AI Agent

Built-in AI agent with multiple tool capabilities:

| Tool Type | Capabilities |
|-----------|-------------|
| File Tools | Read, write, patch, search files; shell execution |
| Terminal Tools | Execute shell commands |
| Browser Tools | Web browsing and manipulation |
| Clarification | Ask user for clarification |
| Network Tools | Web search, page fetching |
| Task Tools | Task list management |
| Skill Tools | Install, view, delete skills |

### Command Approval

When the agent executes potentially risky commands, an approval dialog appears:

- **Approve**: Allow this command
- **Session Approve**: Auto-approve same pattern in this session
- **Deny**: Reject the command
- **Advanced**: Permanent approval or YOLO mode (auto-approve all)

### Dual-Channel Architecture

- **Browser Track**: Connects browser panel for agent web control
- **Data Track**: Connects terminal/file panel for commands and file operations
- Both tracks can be connected simultaneously

## Themes

| Theme | Style | Best For |
|-------|-------|----------|
| Light | Light blue tones | Daily work, bright environments |
| Deep Blue | Dark blue tones | Night coding, low-light |
| Forest | Dark green tones | Long sessions, eye comfort |
| Ocean | Light cyan tones | Refreshing, reading |
| Sunset | Warm orange tones | Cozy, relaxing |
| Sakura | Pink tones | Personalization, aesthetics |

## Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Escape` | Close modal | Close settings, confirm, rename dialogs |
| `Ctrl + Tab` | Next panel | Switch focus between workspace panels |
| `Ctrl + C` | Copy | Copy selected text in terminal; copy file in browser |
| `Ctrl + V` | Paste | Paste clipboard in terminal; paste file in browser |
| `Ctrl + T` | New session | Create a new work session |
| `Ctrl + W` | Close session | Close current session |
| `Ctrl + F` | Search | Open search in file browser |
| `Ctrl + S` | Save | Save edited file in viewer |
| `Enter` | Send | Send message in Dynamic Island |

> **Note**: In terminal, Ctrl+C copies when text is selected; sends SIGINT when nothing is selected.

## Project Structure

```
Nexus/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # Main process entry
│   │   ├── preload.ts  # Preload script
│   │   ├── services/   # Service layer
│   │   ├── db/         # Database related
│   │   ├── ipc/        # IPC communication
│   │   └── utils/      # Utility functions
│   ├── renderer/       # Renderer process
│   │   ├── components/ # React components
│   │   ├── hooks/      # Custom Hooks
│   │   ├── store/      # State management
│   │   └── styles/     # Style files
│   └── core/           # Core business logic
│       ├── types/      # Type definitions
│       └── constants/  # Constants
├── docs/               # Documentation
├── resources/          # Static assets
├── tests/              # Tests
└── package.json
```

## FAQ

**Q: AI model connection fails?**
Check: API URL (http/https prefix), API key validity, network connection. Use the "Test Connection" button in Settings for details.

**Q: How to recover previous sessions?**
All sessions are persisted in SQLite. Just reopen the app—your sessions will be there in the sidebar.

**Q: Dynamic Island disappeared?**
It's an independent floating window. Check your taskbar or use Alt+Tab to find it.

**Q: Agent keeps asking for approval?**
Enable "Session Approve" for same-pattern commands, or use "YOLO mode" in Advanced options to auto-approve all.

**Q: Context window full?**
Use "Clear History" to wipe conversation, or "Compress History" to summarize it into a compact form.

## License

MIT
