# Obsidian Plugin Release Checklist (GitHub)

## A. Metadata consistency

- [x] `manifest.json.version` is the intended release version (`0.1.0`).
- [ ] Git tag equals `manifest.json.version` exactly (no `v` prefix).
- [x] `manifest.json.minAppVersion` is set (`1.5.0`).
- [x] `versions.json` contains compatibility mapping for `0.1.0`.

## B. Build and artifacts

- [x] Build succeeded and generated current `main.js`.
- [x] Release should include required files as individual assets:
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css`
- [x] Required repository files exist:
  - [x] `README.md`
  - [x] `LICENSE`
  - [x] `manifest.json`

## C. Workflow automation

- [x] `.github/workflows/release.yml` is present and valid.
- [x] Workflow has `contents: write` permissions.
- [x] Workflow validates tag/version match before draft release.
- [ ] Tag push tested on GitHub and confirmed draft release creation.

## D. Policy and submission quality gates

- [x] `manifest.json.description` is concise and policy-aligned.
- [x] `isDesktopOnly` is set correctly (`true`).
- [x] README includes purpose and usage guidance.
- [x] README includes network/account disclosure for external providers.
- [ ] Manual self-review against current Obsidian Developer policies completed.
- [ ] Manual self-review against current Plugin guidelines completed.

## E. Initial submission readiness

- [x] `id` is stable and matches plugin folder (`hermes-tts`).
- [x] Community plugin JSON entry draft is prepared (`COMMUNITY_SUBMISSION.md`).
- [ ] Public GitHub repository is created and code pushed.
- [ ] First release tag (`0.1.0`) is pushed and draft/published release exists.
- [ ] PR opened to `obsidianmd/obsidian-releases` using plugin template.

## F. Manual validation still required

- [ ] Plugin smoke-tested in Obsidian desktop after latest build.
- [ ] Provider credential flows manually tested for at least one provider.
- [ ] Optional platform test matrix filled in PR checklist.
