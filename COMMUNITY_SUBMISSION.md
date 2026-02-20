# hermes-TTS Community Submission Pack

## 1) GitHub repository setup

Replace `YOUR_GITHUB_USER` with your account or org.

```bash
cd /Users/matthias/ObsVault_Dev/.obsidian/plugins/hermes-tts

git init
git branch -m main
git add .
git commit -m "Initial release: hermes-TTS 0.1.0"

git remote add origin https://github.com/YOUR_GITHUB_USER/hermes-tts.git
git push -u origin main
```

## 2) Release tag and draft release

Release workflow creates a draft release when a tag is pushed.

```bash
cd /Users/matthias/ObsVault_Dev/.obsidian/plugins/hermes-tts
git tag 0.1.0
git push origin 0.1.0
```

Expected draft assets:

- `manifest.json`
- `main.js`
- `styles.css`

## 3) `community-plugins.json` entry (for obsidian-releases PR)

Use this JSON object in `community-plugins.json` (sorted by `id`):

```json
{
  "id": "hermes-tts",
  "name": "hermes-TTS",
  "author": "Matthias",
  "description": "Generate lightweight audio from a markdown note and prepend timestamped metadata with an embedded audio link.",
  "repo": "https://github.com/YOUR_GITHUB_USER/hermes-tts"
}
```

## 4) PR checklist template (copy into PR body)

```markdown
# I am submitting a new Community Plugin

- [ ] I attest that I have done my best to deliver a high-quality plugin...

## Repo URL
Link to my plugin: https://github.com/YOUR_GITHUB_USER/hermes-tts

## Release Checklist
- [ ] I have tested the plugin on
  - [ ] Windows
  - [ ] macOS
  - [ ] Linux
  - [ ] Android (if applicable)
  - [ ] iOS (if applicable)
- [ ] My GitHub release contains required files
  - [ ] `main.js`
  - [ ] `manifest.json`
  - [ ] `styles.css` (optional)
- [ ] GitHub release name matches `manifest.json.version` exactly (no `v` prefix)
- [ ] `manifest.json.id` matches `community-plugins.json` id
- [ ] README clearly explains purpose and usage
- [ ] I reviewed Developer policies
- [ ] I reviewed Plugin guidelines
- [ ] I added LICENSE
- [ ] I respected third-party licenses and attribution requirements
```

## 5) Current release metadata snapshot

- Plugin id: `hermes-tts`
- Plugin name: `hermes-TTS`
- Version: `0.1.0`
- Min app version: `1.5.0`
