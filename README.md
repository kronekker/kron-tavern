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
* **Zero-CORS Architecture:** Single-port production hosting (NestJS serving the Angular SPA) and seamless dev proxying (`proxy.conf.json`).

---

## 📖 Specifications & Architecture

For full details on architecture, data models, context budgeting, and technical specifications, refer to [PROJECT_SPEC.md](./PROJECT_SPEC.md).
