# kron-tavern

A lightweight, self-hostable AI companion and roleplay platform built for rich storytelling, continuous episodic memory, and radical prompt transparency.

Inspired by platforms like Kindroid and SillyTavern, **kron-tavern** operates with **zero external infrastructure dependencies** by using embedded SQLite (with vector search) and local, in-process ONNX embeddings.

---

## 🌟 Key Features

* **Zero External Services:** Runs on a single node with an embedded SQLite database (`better-sqlite3` + `sqlite-vec`) and local CPU embeddings (`@xenova/transformers`). No Postgres or Docker containers required.
* **Dual-Tiered Memory Engine:**
  * *Tier 1 (Explicit Keyword Lorebooks):* Exact and regex keyword-activated memories.
  * *Tier 2 (Episodic Semantic Memory):* Automated background memory formation from dialog, embedded and retrieved via local vector similarity.
* **Full Prompt & Retrieval Auditability ("The Turn Inspector"):** Inspect the raw system instructions, assembled messages array, exact keyword triggers, and vector similarity scores for every single turn.
* **In-Session A/B Model Testing:** Run two different OpenRouter models concurrently side-by-side to compare latency, formatting, and character fidelity before picking the canonical response.
* **Intelligent Context Management:** User-configurable context compression strategies (sliding window, rolling summaries, selective pruning) triggered at customizable percent-fill thresholds.
* **Mobile-Native Ergonomics:** Responsive, distraction-free chat reading stage with slide-out drawers and bottom sheets.
* **Zero-CORS Architecture:** Single-port production hosting (NestJS serving the Angular SPA on port 3004) and seamless dev proxying (port 4201 -> 3004).

---

## 🚀 Quick Start & Management Script

An interactive bash runner script is included so you don't need to remember commands:

```bash
# Launch interactive menu
./run.sh

# Or run directly via flags:
./run.sh dev       # Starts backend (:3004) & frontend (:4201) concurrently
./run.sh server    # Starts NestJS backend only in watch mode (:3004)
./run.sh client    # Starts Angular frontend only with dev proxy (:4201)
./run.sh build     # Compiles production bundles for client and server
./run.sh start     # Starts the single-port production server on :3004
./run.sh clean     # Cleans build artifacts and caches
./run.sh install   # Installs dependencies across all workspaces
```

### Port Mapping Summary

| Service | Port | Description |
|---|---|---|
| **Backend API** | `3004` | NestJS REST API (`/api/*`) |
| **Swagger UI** | `3004` | Interactive OpenAPI documentation (`http://localhost:3004/api/docs`) |
| **Frontend Dev** | `4201` | Angular CLI with hot reload (`http://localhost:4201`, proxies `/api` to `3004`) |
| **Unified Production** | `3004` | Single port serving both the Angular SPA and backend API |

---

## 📖 Specifications & Architecture

For full details on architecture, data models, context budgeting, and technical specifications, refer to [PROJECT_SPEC.md](./PROJECT_SPEC.md).
