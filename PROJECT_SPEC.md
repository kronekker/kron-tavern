# Project Specification: kron-tavern

**Status:** Specification Approved / Ready for Implementation  
**Last Updated:** 2026-10-12  
**Inspiration:** Kindroid, SillyTavern, Modern Companion & Roleplay Platforms  
**Core Design Tenets:**  
1. **Zero Bloat / Zero External Infrastructure:** Embedded SQLite + local in-process embedding engine.  
2. **Full Traceability & Transparency:** Auditable prompts, vector scores, and token diagnostics.  
3. **Mobile-Native UX:** Chat readability first, distraction-free interface with slide-out drawers.  
4. **Model Experimentation:** In-session A/B model testing and comparison.  
5. **Configurable Context Compression:** Dynamic context pruning and rolling summarization triggered by budget thresholds.  
6. **Unified / Zero-CORS Hosting:** Seamless dev proxy and single-port unified production serving.

---

## 1. Vision & Core Philosophy

**kron-tavern** is a self-hostable, lightweight AI companion and roleplay platform built for rich storytelling, continuous episodic memory, and radical transparency. 

Key defining traits:
* **Self-Contained Deployment:** Single-node runtime utilizing embedded SQLite (via `better-sqlite3` and `sqlite-vec`) for both relational and vector data, and local in-process embeddings via `@xenova/transformers`. No external database servers or Docker containers required.
* **Full Prompt & Retrieval Auditability:** Users can inspect the exact prompt assembly, token count, raw system instructions, and exact vector similarity scores for injected memories for any conversation turn.
* **Model Playground & A/B Testing:** Direct comparative evaluation of two different Wiro.ai models responding to the same conversational turn, allowing users to select the canonical path forward.
* **Multimodal Generation (Wiro.ai):** Unified access to Chat LLMs, Text-to-Image (character portraits), Image-to-Image (character poses/scenes), and Video animation models.
* **Shared Admin-Maintained Model Catalog:** Admin retrieves and refreshes available models via Wiro.ai (`Tool/List`), persisting them as a shared local JSON catalog (`data/wiro-models.json`) for all users to select from.
* **Advanced Context Engineering:** Configurable context compression algorithms with user-defined percent-fill triggers and smart defaults.
* **Zero-CORS Runtime Modes:** Smooth development ergonomics and a single-port production distribution where Node serves the Angular SPA.

---

## 2. High-Level Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Angular 19+ Frontend                            │
│  - Mobile-Native First, Fluid Desktop Expansion                        │
│  - Immersive Chat Timeline (Markdown, Dialogue/Action Styling)        │
│  - A/B Model Split/Comparison View & Selection                         │
│  - Multimodal Model Browser (Chat, Text-to-Image, Image-to-Image)      │
│  - Slide-Over Drawers: Nav, Turn Inspector, Settings, Persona Switch   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST (OpenAPI/Swagger) + SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                      Node.js (TypeScript) Backend                      │
│  - Framework: NestJS (TypeScript-first with native @nestjs/swagger)    │
│    -> Auto-generated interactive Swagger UI (/api/docs)                │
│  - SPA Static Host (@nestjs/serve-static) for Production               │
│  - Local In-Process Embedding Engine (@xenova/transformers ONNX)       │
│  - Context Manager & Compression Engine (Percent-fill triggers)        │
│  - Memory Pipeline: Keyword Triggering + SQLite Vector Search          │
│  - Wiro.ai Gateway (Chat LLMs, Image Gen & Video) & Audit Logger       │
│  - Shared Model Catalog Manager (data/wiro-models.json)                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
         ┌─────────────────────────┐   ┌─────────────────────────┐
         │     SQLite Database     │   │     Local Embeddings    │
         │  (Relational + Vectors) │   │  (@xenova/transformers) │
         │  - Users & Auth         │   │  - all-MiniLM-L6-v2 or  │
         │  - Personas & Avatars   │   │    bge-small-en-v1.5    │
         │  - Characters & Lore    │   │  - Runs on CPU (ONNX)   │
         │  - Sessions & A/B Runs  │   │  - Zero API Cost        │
         │  - Turn Traces          │   └─────────────────────────┘
         │  - sqlite-vec Extension │
         └─────────────────────────┘
```

---

## 3. Hosting & Runtime Modes (Zero-CORS Architecture)

To eliminate Cross-Origin Resource Sharing (CORS) complexity and ensure seamless deployment across local dev and production, the application operates in two distinct runtime modes:

```
[Development Mode]
  Angular CLI (Port 4201) --(proxy.conf.json /api)--> Node Backend (Port 3004)
  * Hot reload active for both apps, zero CORS errors via dev proxy.

[Production / Unified Host Mode]
  Node Backend (Port 3004, or process.env.PORT)
    ├── GET /api/*         -> NestJS REST Controllers & SSE Streams
    ├── GET /api/docs      -> Swagger Interactive UI
    └── GET /*             -> Static Angular SPA Build (dist/client/browser)
  * Entire app runs on a single host and port.
```

1. **Development Mode (`npm run dev`):**
   * Backend runs on port `3004` (configurable via `PORT`, default 3004) with TS watch/reload.
   * Frontend runs on port `4201` via Angular dev server (`ng serve --port 4201`).
   * Angular uses a configured `proxy.conf.json` that forwards all `/api` requests to `http://localhost:3004`. The browser only ever talks to port `4201`, preventing CORS issues during development.
2. **Production Mode (`npm run build` && `npm start`):**
   * Angular builds production artifacts into the backend's static assets directory (`dist/client`).
   * The Node.js backend serves both the API endpoints (`/api/...`) and the Angular SPA static bundle (with SPA index.html fallback) from the **same single port (3004)**.
   * Single-command deployment with zero CORS overhead or reverse proxy requirement.

---

## 4. Frontend UX: Mobile-Native First & Clutter-Free

The UI is built primarily for mobile ergonomics and fluidly expands into widescreen desktop mode without losing its focus on reading immersion.

### 4.1. Design Philosophy
* **Conversation Stage First:** The chat feed occupies 100% of the visual hierarchy by default.
* **Zero UI Clutter:** Menus, character switchers, settings, and debugging panels do not permanently take up screen real estate.
* **Popups, Bottom Sheets & Drawers:**
  * **Mobile:** Bottom sheets for quick actions (persona switcher, model picker, turn actions); slide-over side drawer for conversation history and navigation.
  * **Desktop:** Responsive split view where drawers can optionally pin as collapsable sidebars while preserving the central reading column.

### 4.2. Chat Presentation
* Distinct styling for dialogue (`"speech"`), narration/actions (`*italicized narration*`), and inner monologues.
* Smooth text streaming with auto-scroll lock (breaks gracefully when the user scrolls up to read history).
* Per-message action tray (hidden until tapped/hovered): Inspect Turn, Edit, Regenerate, Delete, Branch, A/B Test.

---

## 5. Model Experimentation: In-Session A/B Testing Mode

To evaluate model suitability, prompt fidelity, and cost-to-performance trade-offs, users can activate **A/B Testing Mode** for any session.

```
                    [User Message]
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
     [Model A Query]             [Model B Query]
     (e.g., Claude 3.5 Sonnet)   (e.g., Llama 3.3 70B)
            │                           │
            ▼                           ▼
     [Response Card A]           [Response Card B]
     - Latency: 820ms            - Latency: 510ms
     - Cost: $0.003              - Cost: $0.0008
     - Trace A Inspector         - Trace B Inspector
            │                           │
            └─────────────┬─────────────┘
                          ▼
            [User Selects Winner]
      (Winner becomes canonical message in session;
       loser response archived in turn trace for review)
```

### 5.1. Capabilities
* **Independent Model Specs:** Model A and Model B can have distinct model IDs (e.g., Claude 3.5 Sonnet vs. Hermes 3 70B), temperatures, and system prompt formatting.
* **Side-by-Side Presentation:**
  * **Mobile:** Swipeable carousel or toggle pills (`[ Model A ] | [ Model B ]`).
  * **Desktop:** Clean dual-column comparison view.
* **Commit to History:** The user selects the winning response to continue the narrative thread, with full traces preserved for both generations.

---

## 6. Intelligent Context Management & Compression

As roleplays extend into hundreds or thousands of messages, naive sliding windows either drop crucial backstory or blow out token budgets. `kron-tavern` provides configurable, transparent context compression.

### 6.1. Percent-Fill Triggers
* Users configure a context threshold trigger (e.g., **75% of model's max context limit**).
* Whenever total context (System Prompt + Persona + Memories + Chat History) crosses this threshold, the configured compression strategy executes before or immediately after the turn.

### 6.2. User-Configurable Compression Strategies

| Strategy | Behavior | Best Used For |
|---|---|---|
| **1. Episodic Offload & Sliding Window (Default)** | Oldest turns beyond a protected buffer ($N$ turns) are consolidated into Tier 2 Episodic Memories and pruned from the raw prompt. | General companion roleplay with seamless long-term continuity. |
| **2. Rolling Executive Summary** | A fast background LLM condenses older turns into an evolving structured narrative summary block injected before recent turns. | Plot-heavy RPG adventures where macro story state matters. |
| **3. Selective Pruning** | Retains anchor messages (greeting, scenario introduction, pivotal user choices) while discarding intermediate conversational banter. | Fixed scenarios and mission-driven roleplays. |
| **4. Strict FIFO Sliding Window** | Strictly truncates oldest messages with zero summarization overhead. | Budget-conscious or high-speed casual chats. |

### 6.3. Context Budget Breakdown & Inspection
The Turn Inspector visualizes the context allocation:
* `[████████░░░░░░░░░░░░] 42% Total Context Utilized`
  * System Prompt & Persona: 850 tokens (10%)
  * Injected Keyword Lore: 320 tokens (4%)
  * Recalled Episodic Memories: 610 tokens (7%)
  * Rolling Summary: 400 tokens (5%)
  * Active Chat Messages: 1,420 tokens (16%)
  * Available Headroom: 4,400 tokens (58%)

---

## 7. User Entitlements & Scoping Architecture

### 7.1. User Model & First-User Admin Bootstrap
* **Authentication:** Users register with `email`, `username`, and `password`. Sign-in reuses credentials with secure session JWTs / tokens.
* **The "First-User Admin" Rule:**
  * When the first user account is created in a fresh instance (`COUNT(*) == 0`), they are automatically granted **Admin Status (`is_admin = 1`)**.
  * All subsequent registered accounts default to standard user status (`is_admin = 0`).
  * **Admin Entitlements:** Only Admin users can access the `/api/admin/*` endpoints and open the DB & System Administration panel (table explorer, vacuum, integrity checks, and maintenance actions).

### 7.2. Entity Scoping Rules

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Scope Hierarchy                                 │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Characters:                                                         │
│    - Private (Default): Visible only to creator.                       │
│    - Public: Visible in gallery to all users. Sessions remain isolated.│
├────────────────────────────────────────────────────────────────────────┤
│ 2. Personas:                                                           │
│    - Always Private: Users can only see and manage their own personas. │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Sessions & Messages:                                                │
│    - Always Private: Tied strictly to the user who launched them.      │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Memories (Keyword & Vector Episodic):                               │
│    - Session Exclusive (Default): Recalled only in the originating chat│
│    - User-Global: User can promote memories to be active across ALL    │
│      of their personal chat sessions.                                  │
│    - Character-Global: Creator-defined lore active for that character. │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 8. The Dual-Tiered Memory Engine

### 8.1. Tier 1: User-Defined Keyword Memories (Lorebooks)
* **Keyword Matching:** Exact word, phrase, or regex matching on the last $N$ turns.
* **Scope Support:** Can be scoped to a single `session`, to a `character`, or `user`-global.

### 8.2. Tier 2: Automated Episodic Memory Formation
* **Extraction:** In background or upon threshold trigger, an extraction prompt parses recent turns for facts, relationships, and user details.
* **Local Embedding:** Processed via in-memory `@xenova/transformers` (`all-MiniLM-L6-v2`, 384 dimensions).
* **Vector Search:** Query vector searched via `sqlite-vec` with cosine similarity score cutoff.
* **Scope Promotion:** Default is `session` scope. The user can review formed memories and promote them to `user`-global so other sessions benefit from that accumulated context.

---

## 9. Traceability: The Turn Inspector

Every generated message includes an **Inspect Turn** action in its menu, displaying:
1. **Raw API Request:** Full JSON payload sent to Wiro.ai (exact system, user, and assistant array).
2. **Memory Breakdown:**
   * Triggered keyword entries (showing scope: session, character, or global).
   * Retrieved semantic memories with similarity scores.
3. **Execution Diagnostics:** Model ID, latency, prompt tokens, completion tokens, estimated cost.
4. **Compression Status:** Current context fill percentage, whether a compression event fired on this turn, and summary delta.

---

## 10. Relational & Vector Schema (SQLite)

```sql
-- Identity & Personas
users (id, email, username, password_hash, wiro_key_encrypted, settings_json, is_admin, created_at, updated_at)
personas (id, user_id, name, avatar_url, description, speech_style, is_default, created_at, updated_at)

-- Characters
characters (id, creator_id, name, avatar_url, tagline, greeting, system_prompt, 
            scenario, dialogue_examples, is_public, default_model, temperature, created_at, updated_at)

-- Memories & Lore (with explicit scoping)
keyword_memories (id, character_id, session_id, user_id, title, keywords, content, 
                  scope, priority, is_active, created_at, updated_at)
                  -- scope: 'session', 'character', 'user'

episodic_memories (id, character_id, session_id, user_id, memory_text, 
                   scope, importance, source_turn_id, created_at)
                   -- scope: 'session', 'user'

-- Sessions & Group Chats
sessions (id, user_id, title, is_group, active_persona_id, 
          context_strategy, context_threshold_percent, rolling_summary, created_at, updated_at)
session_participants (id, session_id, character_id, sort_order)
messages (id, session_id, sender_type, sender_id, content, is_canonical, ab_group_id, model_used, created_at)

-- Turn Auditing & A/B Traces
turn_traces (id, message_id, session_id, model_used, prompt_tokens, completion_tokens,
             latency_ms, raw_request_json, raw_response_json, 
             triggered_keywords_json, recalled_memories_json, 
             context_fill_percent, created_at)

-- sqlite-vec Virtual Table
vec_episodic_memories USING vec0(memory_id TEXT PRIMARY KEY, embedding float[384])
```

---

## 11. Workspace & Repository Structure

We recommend a clean monorepo layout using npm/pnpm workspaces:

```
kron-tavern/
├── PROJECT_SPEC.md              # Living specification & architecture document
├── package.json                 # Root workspace orchestrator
├── tsconfig.base.json           # Shared base TypeScript configuration
├── server/                      # Node.js backend (NestJS + SQLite + Transformers)
│   ├── src/
│   │   ├── auth/                # JWT auth & BYOK encrypted keys
│   │   ├── characters/          # Character & persona CRUD
│   │   ├── chat/                # Wiro.ai gateway, multimodal generation, A/B engine & SSE streaming
│   │   ├── context/             # Context budgeter & compression algorithms
│   │   ├── memory/              # Keyword matcher + local embedding & sqlite-vec
│   │   ├── trace/               # Audit logger & Turn Inspector API
│   │   ├── main.ts              # Server bootstrap & Swagger setup
│   │   └── app.module.ts        # Root module + ServeStatic for production SPA
│   ├── package.json
│   └── tsconfig.json
├── client/                      # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/      # Chat feed, Turn Inspector drawer, A/B comparison
│   │   │   ├── services/        # API client, SSE streaming service, state store
│   │   │   └── pages/           # Chat room, Character gallery, Persona manager
│   │   └── styles.scss          # Mobile-first styles / Tailwind
│   ├── proxy.conf.json          # Dev proxy aliasing /api to backend (port 3004)
│   ├── angular.json
│   └── package.json
└── uploads/                     # Local storage for avatars & media
```
