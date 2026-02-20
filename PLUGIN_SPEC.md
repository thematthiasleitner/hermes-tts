# Obsidian Plugin Spec

## 1. Problem and Outcome

- Problem statement: Users want fast, repeatable note-to-audio conversion without manually copying note text into separate TTS tools.
- Target users: Obsidian users who consume notes as audio while commuting, walking, or reviewing content.
- Primary user outcome: One command generates lightweight audio from a Markdown note and inserts a clear traceable metadata block with embedded playback.
- Success metric (quantifiable): From command trigger to saved audio + metadata insertion in under 20 seconds for a normal note on a working provider.

## 2. Context and Constraints

- Existing workflow in Obsidian: Users write and organize notes, then manually run external TTS tools.
- Required Obsidian APIs/integration points: Commands, settings tab, vault file read/write, binary file write, suggest modal.
- Platform constraints (desktop/mobile): Desktop first (`isDesktopOnly: true`) due provider SDK/network usage.
- Performance constraints: Must avoid blocking UI; text processing and network call run async.

## 3. MVP Scope

- In-scope capability 1: Generate TTS audio for current note or selected Markdown note.
- In-scope capability 2: Persist generated audio in configurable folder with deterministic timestamped filename.
- In-scope capability 3: Prepend timestamped metadata + embedded audio link near top of source note.

## 4. vNext Scope

- Deferred enhancement 1: Batch conversion for multiple notes in one run.
- Deferred enhancement 2: Optional replacement/update mode for existing metadata blocks instead of always prepending.

## 5. Out of Scope

- Explicitly excluded behavior 1: Full SSML editing UI and prosody controls per paragraph.
- Explicitly excluded behavior 2: Automatic transcript alignment with word-level timestamps.

## 6. User Stories

- As a note author, I want to generate playable audio from my note in one command, so that I can review it away from screen.
- As a plugin power user, I want Aloud-style provider switching (OpenAI, Gemini, Google Cloud, Azure, ElevenLabs, AWS, OpenAI-compatible), so that I can swap vendors without changing workflow.

## 7. UX Surface

- Commands: Generate for active note, generate for selected note.
- Ribbon/menu actions: Optional ribbon icon for active note generation.
- Settings tab fields: Output controls, global voice prompt field, provider selector, provider-specific credentials/model/voice, and per-provider voice dropdowns with refresh actions.
- Views/modals/editors: Fuzzy file picker modal for selecting a Markdown note.

## 8. Data and Settings

- Persisted settings schema: Output path/format, global voice prompt text, and per-provider credentials/model/voice settings with cached voice lists for providers that support discovery.
- Defaults: Audio folder `Attachments/TTS Audio`, provider `openai`, output format `mp3`.
- Migration rules: Additive settings only; missing keys fall back to defaults.

## 9. Acceptance Checks

- [ ] Check 1 (observable behavior): Running command on current note creates audio file in configured folder.
- [ ] Check 2 (observable behavior): Source note is updated with prepended timestamped metadata callout and embedded audio link.
- [ ] Check 3 (observable behavior): Plugin can switch providers via Aloud-style provider selector and expose voice dropdowns for major providers.

## 10. Release Criteria

- Minimum app version: 1.5.0
- Planned plugin version: 0.1.0
- Required release assets: `manifest.json`, `main.js`, `styles.css`
- Release risks and mitigations: Provider credentials may be incomplete or unsupported for TTS; plugin surfaces explicit notices with missing field names.
