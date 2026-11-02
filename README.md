# brewdio

> A **local-first** homebrewing app designed to be powerful and fun to use.

brewdio is a modern, privacy-focused brewing companion that puts you in control of your recipes, ingredients, and brew days. Core brewing features run locally with no account or subscription. An optional self-hosted server provides authenticated multi-device sync and integrations.

---

## About This Fork

This repository is an independent, self-hosted continuation of the original
[brewdio project](https://github.com/brewdio/brewdio). It keeps the local-first
foundation while adding inventory management, Norwegian localization, authenticated
sync, and integration APIs for a connected brewery workflow.

The upstream project and this fork may evolve independently. Changes specific to this
repository are maintained by [sammynorway](https://github.com/sammynorway).

### What This Fork Adds

| Area | Original project | This repository |
|------|------------------|-----------------|
| Languages | English interface | English and Norwegian, with browser-language detection and a manual selector |
| Ingredients | Built-in ingredient reference data | Personal inventory with quantities, best-before dates, recipe selection, and shortage previews |
| Water planning | Equipment-aware total water calculation | Capacity-aware strike and sparge split that accounts for kettle size and grain displacement |
| Batch lifecycle | Recipe-based batch tracking | Optional inventory deduction when a batch starts and restoration when that batch is deleted |
| Synchronization | Optional unauthenticated relay | Self-hosted authentication, persistent user accounts, and user-isolated synchronized data |
| Integrations | No external brewing-system API | Revocable integration keys plus Recipe and Batch APIs |
| CraftBeerPi | No dedicated integration | Separate [CraftBeerPi 4 plugin](https://github.com/sammynorway/brewdio-craftbeerpi-plugin) for recipe selection and brew-start reporting |

---

## Features

### Recipe Management
- **BeerJSON Compliant** — Industry-standard recipe format ensures portability and future-proofing
- **Smart Calculations** — Automatic OG, FG, ABV, IBU, and color calculations using proven brewing formulas
- **Ingredient Database** — Comprehensive libraries of hops, fermentables, and yeast strains
- **Style Guidelines** — Built-in BJCP style ranges to help you hit your targets
- **Equipment Profiles** — Customize loss calculations for your specific mash tun, kettle, and fermenter

### Batch Tracking
- **Brew Day Companion** — Create batches from recipes and follow them throughout the brew day
- **Water Calculator** — Visual water requirement calculator with equipment-specific adjustments
- **Capacity-Aware Mash Water** — Splits strike and sparge water while respecting kettle capacity and grain displacement
- **Inventory-Aware Batches** — Deduct ingredients when a batch is created and restore them when that batch is deleted
- **Batch Notes** — Markdown-enabled notes for documenting your process and results

### Inventory Management
- **Ingredient Inventory** — Track fermentables, hops, cultures, quantities, and best-before dates
- **Recipe Integration** — Select ingredients from inventory while building recipes
- **Shortage Planning** — Preview available stock and shortages before starting a batch
- **FEFO Deductions** — Uses ingredients with the earliest best-before date first

### Multi-Device Sync
- **Automerge CRDTs** — Conflict-free sync of recipes, batches, settings, and equipment profiles
- **Authenticated Server** — Self-hosted Rust server keeps each user's synchronized data isolated
- **Auto-Reconnect** — Clients automatically reconnect and resume sync after disconnects

### Integrations
- **Scoped API Keys** — Create and revoke integration keys without exposing account credentials
- **Recipe API** — Authenticated API for listing and reading Brewdio recipes
- **Batch API** — Idempotent batch creation with server-calculated inventory deductions
- **CraftBeerPi 4** — Optional plugin synchronizes recipes and starts Brewdio batches from CraftBeerPi

### AI Brewing Assistant
- **Recipe Helper** — Chat-based assistant that can search ingredients, suggest styles, and create or modify recipes
- **Context-Aware** — Knows which recipe you're viewing and can read/update it directly
- **Tool-Based** — Uses structured tool calls for ingredient search, recipe creation, and editing
- **Multi-Provider** — Works with any OpenAI-compatible API: OpenAI, Gemini, Groq, Together, Ollama, LM Studio, and more
- **Private** — Runs against your own API key; nothing leaves your device except API calls

### User Experience
- **Local-First** — All data stored locally using SQLite (IndexedDB-backed in the browser, native on desktop)
- **Two Interfaces** — Full-featured web UI and terminal UI sharing the same data layer and sync protocol
- **Vim-Style TUI** — Navigate recipes, manage ingredients, and track batches entirely from the terminal with keyboard-driven workflows
- **Dark Mode** — Beautiful dark mode support in the web UI
- **English and Norwegian** — Switch the interface language from settings or follow the browser language
- **Retro Dials** — Playful retro-cockpit gauge displays for calculated values
- **Live Vitals** — Real-time OG, FG, ABV, IBU, and SRM with color-coded BJCP style range bars (TUI and web)
- **Inline Editing** — Edit recipe values directly without cumbersome forms
- **JSON Editor** — Power users can edit raw BeerJSON with Monaco, optional Vim mode

---

## Architecture

brewdio is a Rust workspace with a shared core compiled to both WebAssembly and native targets:

```
brewdio/
├── brewdio-core/          # Brewing calculations, units, ingredient & style data
├── brewdio-persistence/   # SQLite storage & Automerge CRDT sync
│   ├── connection.rs          # Generic Connection trait
│   ├── connection_native.rs   # Native SQLite (rusqlite)
│   ├── connection_wasm.rs     # WASM SQLite (sqlite-wasm-rs + IndexedDB VFS)
│   ├── db.rs                  # Recipe CRUD + sync dispatch
│   ├── batch.rs               # Batch CRUD
│   ├── settings.rs            # User settings
│   ├── equipment_profile.rs   # Equipment profile CRUD
│   ├── sync.rs                # Automerge SyncSession wrapper
│   ├── protocol.rs            # Wire protocol (Hello, SyncDoc, NewDoc)
│   └── sync_worker.rs         # Native background sync worker (tokio)
├── brewdio-wasm/          # wasm-bindgen bindings (core + persistence + SyncWorker)
├── brewdio-server/        # Authenticated sync and integration API server
├── brewdio-tui/           # Terminal UI (ratatui + tui-textarea)
│   └── src/chat/              # AI chat client, tools, and UI
└── brewdio-webui/         # React web frontend
    └── src/
        ├── routes/            # File-based routing (TanStack Router)
        ├── components/        # UI components (shadcn/ui)
        └── lib/
            ├── db/            # WASM database hooks & TanStack Query integration
            ├── sync.ts        # WebSocket sync transport layer
            ├── ai/            # AI chat transport & hooks
            └── ai-tools/      # Tool definitions for the AI assistant
```

### Crates

| Crate | Description |
|-------|-------------|
| `brewdio-core` | Brewing calculations, unit conversions, and ingredient/style data. Pure Rust, no I/O. |
| `brewdio-persistence` | SQLite-backed storage with Automerge CRDT sync. Compiles to both native (rusqlite) and WASM (sqlite-wasm-rs). |
| `brewdio-wasm` | wasm-bindgen bindings that expose core + persistence + SyncWorker to JavaScript/TypeScript. |
| `brewdio-server` | Self-hosted authenticated sync server and integration API for recipes, batches, and API keys. |
| `brewdio-tui` | Terminal UI built with ratatui. Full recipe/batch/settings management with vim-style navigation, live vitals, ingredient search, equipment profiles, AI chat assistant, and background sync. |

### Terminal UI

The `brewdio-tui/` crate is a full-featured terminal interface built with [ratatui](https://ratatui.rs/):

- **Vim-style navigation** — `j/k` movement, `n` to create, `d` to delete, `q` to go back
- **Three main tabs** — Recipes, Batches, Settings (switch with `Tab` or `1`/`2`/`3`)
- **Recipe editor** — Multi-panel layout with header, live vitals panel, and tabbed ingredient lists
- **Live vitals** — Real-time OG, FG, ABV, IBU, and SRM with color-coded range bars showing BJCP style guidance
- **Multi-step ingredient dialogs** — Fuzzy-searchable selection for fermentables, hops, and cultures with amount/unit/timing steps
- **Equipment profiles** — 40+ built-in profiles with efficiency %, searchable selector with confirmation prompt
- **Batch management** — Create batches from recipes, edit brew dates, independent batch notes
- **Trash & recovery** — Soft-delete recipes with `d`, toggle trash view with `r`, undelete with `u`
- **Notes editor** — Multiline modal editor for recipe and batch notes with readline-style shortcuts
- **AI chat panel** — Side-panel or fullscreen chat (`c` to open, `Tab` to toggle size) with streaming responses and persistent history
- **Change history** — View Automerge CRDT change log with timestamps and actor IDs
- **Background sync** — Set `BREWDIO_SERVER_URL` to enable; status indicator in top-right corner (green = connected)
- **XDG data directory** — Database stored at `~/.local/share/brewdio/brewdio.db`

### Web UI

The `brewdio-webui/` directory is a React + TypeScript frontend that consumes `brewdio-wasm`:

- **[React 19](https://react.dev/)** with **[TanStack Router](https://tanstack.com/router)** (file-based routing)
- **[Tailwind CSS](https://tailwindcss.com/)** + **[shadcn/ui](https://ui.shadcn.com/)**
- **[Vite](https://vite.dev/)** for development and builds
- **[TanStack Query](https://tanstack.com/query)** for data fetching with automatic cache invalidation on sync
- Data stored in IndexedDB via the WASM SQLite layer

### Sync Architecture

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│  WebUI   │◄──WS──►│  brewdio-    │◄──WS──►│   TUI    │
│ (browser)│         │   server     │         │(terminal)│
└──────────┘         └──────────────┘         └──────────┘
     │                      │                       │
  IndexedDB             SQLite                   SQLite
```

- All sync protocol logic (Hello handshake, NewDoc exchange, SyncDoc messages) lives in Rust
- WebUI: `SyncWorker` WASM struct handles the protocol; JS handles only WebSocket transport (~100 lines)
- TUI: native `sync_worker.rs` runs as a tokio background task
- Server: authenticates clients, isolates data by user, persists synchronized documents, and broadcasts changes to that user's connected clients

### CraftBeerPi Integration

CraftBeerPi support is split across two repositories so the Brewdio application and
the CraftBeerPi plugin can be installed and released independently:

- **This repository** owns the Brewdio data model, inventory logic, authenticated
  integration keys, Recipe API, and idempotent Batch API.
- **[brewdio-craftbeerpi-plugin](https://github.com/sammynorway/brewdio-craftbeerpi-plugin)**
  owns the CraftBeerPi 4 plugin, recipe conversion, synchronization, and CraftBeerPi
  configuration.

The plugin reads recipes using a key with the `recipes:read` scope. When a brew starts,
it calls the Brewdio Batch API with `batches:write`; Brewdio creates the batch and
calculates inventory deductions on the server. The plugin source is intentionally not
duplicated in this repository.

---

## Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/)
- [Bun](https://bun.sh/) 1.0+

### Development

```bash
# Run Rust tests (excludes WASM cdylib)
cargo test --workspace --exclude brewdio-wasm

# Build WASM package
cd brewdio-wasm && wasm-pack build --target web

# Run WASM integration tests
cd brewdio-wasm && bun install && bun test

# Start web UI dev server
cd brewdio-webui && bun install && bun dev

# Build and run the TUI
cargo run -p brewdio-tui

# Start the sync server (default port 3000)
cargo run -p brewdio-server
```

### Self-Hosted Sync Server

The server is optional for local recipe work. It is required for authenticated
multi-device synchronization and external integrations such as CraftBeerPi.

For a persistent installation, set a stable JWT secret before starting the server.
If the secret is omitted, the server generates a temporary one and all login tokens
become invalid after a restart.

```bash
export BREWDIO_JWT_SECRET="replace-with-a-long-random-secret"
export BREWDIO_DB="/path/to/brewdio.db"
export PORT="3000"
cargo run -p brewdio-server --release
```

In the web interface:

1. Open **Settings → Synchronization**.
2. Enter the WebSocket address, for example `ws://192.168.1.100:3000/ws`.
3. Select **Sign in / Create account** and authenticate against that server.
4. Connect synchronization after a successful sign-in.

Use HTTPS/WSS through a reverse proxy when the server is reachable outside a trusted
local network. The `--no-auth` option is intended only for isolated development and
testing.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BREWDIO_DB` | `brewdio.db` | Path to the SQLite database (server & TUI) |
| `BREWDIO_SERVER_URL` | — | WebSocket server URL for TUI sync (e.g. `ws://localhost:3000/ws`) |
| `BREWDIO_JWT_SECRET` | Random per start | Secret used to sign login tokens; set a stable, private value in production |
| `BREWDIO_ALLOW_SIGNUPS` | `true` | Set to `false` or `0` to disable new account registration |
| `BREWDIO_ADMIN_EMAIL` | — | Optional administrator account created or updated at server startup |
| `BREWDIO_ADMIN_PASSWORD` | — | Password for the optional administrator account; use together with `BREWDIO_ADMIN_EMAIL` |
| `BREWDIO_GOOGLE_CLIENT_ID` | — | Optional Google client ID for Google sign-in |
| `PORT` | `3000` | Port for the sync server |

### Integration API and CraftBeerPi

Integration keys are created from Brewdio after signing in. They are separate from
account passwords, can be revoked, and currently receive the `recipes:read` and
`batches:write` scopes required by the CraftBeerPi plugin.

The plugin is maintained and released separately:

- [sammynorway/brewdio-craftbeerpi-plugin](https://github.com/sammynorway/brewdio-craftbeerpi-plugin)

CraftBeerPi uses the Recipe API to list Brewdio recipes. When a selected recipe starts
brewing, the plugin creates the corresponding Brewdio batch through the Batch API.
Brewdio then calculates and records the inventory deductions, keeping the inventory
logic in one system.

### AI Assistant Configuration

The AI assistant is configured in the Settings tab (both TUI and web UI):

| Setting | Default | Description |
|---------|---------|-------------|
| AI API Key | — | API key for your chosen provider |
| AI Base URL | `https://api.openai.com/v1` | Base URL for the API (blank = OpenAI) |
| AI Model | `gpt-4o-mini` | Model name (blank = gpt-4o-mini) |

Works with any OpenAI-compatible endpoint. Example provider URLs:
- **OpenAI** — leave blank (default)
- **Gemini** — `https://generativelanguage.googleapis.com/v1beta/openai`
- **Groq** — `https://api.groq.com/openai/v1`
- **Ollama** — `http://localhost:11434/v1`

### Building for Production

```bash
# Build WASM
cd brewdio-wasm && wasm-pack build --target web

# Build web UI
cd brewdio-webui && bun install && bun run build

# Build server
cargo build -p brewdio-server --release
```

---

## Brewing Calculations

brewdio implements proven brewing formulas:

- **IBU (Tinseth Method)** — Accurate bitterness calculations accounting for alpha acids, boil time, and gravity
- **Original Gravity (OG)** — Based on fermentable extract and batch size
- **Final Gravity (FG)** — Estimated using yeast attenuation
- **ABV** — Standard formula: `(OG - FG) * 131.25`
- **SRM Color** — Morey equation for beer color prediction
- **Water Requirements** — Equipment-aware water calculations with grain absorption, boil-off, and dead space losses
- **Carbonation** — Priming sugar and forced carbonation calculations

---

## BeerJSON Compliance

brewdio uses [BeerJSON](https://beerjson.org/) as its native recipe format. This ensures:

- **Portability** — Share recipes with other BeerJSON-compatible software
- **Future-Proof** — Industry-standard format that will be supported for years
- **Complete Data** — Captures everything from ingredients to mash schedules
- **Extensible** — Easy to add new fields as needed

---

## Local-First Philosophy

- **Your Data, Your Device** — Core brewing data is stored locally; a server is only required for optional sync and integrations.
- **Offline by Default** — Works without an internet connection. Perfect for brew days in the garage.
- **CRDT Sync** — Optional multi-device sync via Automerge. Changes merge automatically, even after offline edits.
- **No Vendor Lock-in** — Export your recipes as standard BeerJSON files and use them anywhere.
- **Privacy First** — Zero tracking, zero telemetry, zero data collection.

---

## Contributing

This fork is developed independently from upstream. Contributions and issue reports
for the features in this repository are welcome here. Contributions intended for the
original project should be directed to
[brewdio/brewdio](https://github.com/brewdio/brewdio).

---

## License

This project is open source. Check the LICENSE file for details.

---

## Acknowledgments

- **[brewdio/brewdio](https://github.com/brewdio/brewdio)** — The original project and local-first foundation for this fork
- **[BeerJSON](https://beerjson.org/)** — For providing an excellent standard format
- **[Automerge](https://automerge.org/)** — For making local-first CRDT sync practical
- **Brewing Community** — For sharing formulas and best practices

---

**Happy Brewing!**
