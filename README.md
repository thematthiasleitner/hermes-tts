# hermes-TTS

Convert any Obsidian Markdown note into lightweight speech audio, then prepend a timestamped metadata callout with an embedded audio link.

## What changed

This plugin now uses an **Aloud-style API link-up** pattern:

- One **Model Provider** selector in settings.
- Provider-specific fields shown only for the selected provider.
- Voice selection is done via **dropdowns** for all major providers.
- New **Voice prompt** section for optional speaking-style instructions.
- Output is always normalized to MP3.
- Character limit is no longer user-configurable (notes are processed without a fixed UI cap).
- File name prefix and speech speed settings were removed to simplify configuration.

## Supported providers

- OpenAI
- Google Gemini
- Google Cloud Text-to-Speech
- Azure Speech
- ElevenLabs
- AWS Polly
- OpenAI-compatible endpoints (custom base URL)

## Policy disclosures

- Network access is required. The plugin sends note text to the selected external TTS provider.
- External accounts and API keys are required for provider usage (OpenAI, Google, Azure, ElevenLabs, AWS, or compatible API).
- The plugin does not include telemetry or ads.

## Voice dropdown behavior

- OpenAI/Gemini: curated built-in voice dropdowns.
- Google Cloud/Azure/ElevenLabs/AWS Polly: dropdowns with refresh buttons to fetch latest provider voices.
- OpenAI-compatible: OpenAI-style voice dropdown.
- Audio from all providers is normalized and saved as MP3.

## Voice prompt behavior

- The **Voice prompt** setting is global and optional.
- OpenAI: sent as `instructions` only when using `gpt-4o-mini-tts` models (per API behavior).
- Gemini: prepended as style notes before the transcript in the prompt.
- Other providers currently ignore this field.

## Gemini reliability fallback

- Gemini uses the official `@google/genai` SDK flow (matching Aloud plugin setup).
- On Gemini `400` "tried to generate text" errors, the plugin retries in segmented transcript mode with rolling previous-context continuity.
- If Gemini fails with transient errors and **Google Cloud TTS** is configured, generation automatically falls back to Google Cloud.
- Metadata uses the provider that actually generated the audio.

## Commands

- `Generate Hermes-TTS audio (current note)`
- `Generate Hermes-TTS audio (pick note)`

## Provider documentation

| Provider | API docs | Voice docs |
| --- | --- | --- |
| OpenAI | <https://platform.openai.com/docs/guides/text-to-speech> | <https://platform.openai.com/docs/guides/text-to-speech#voice-options> |
| Google Gemini | <https://ai.google.dev/gemini-api/docs/speech-generation> | <https://ai.google.dev/gemini-api/docs/speech-generation#voices> |
| Google Cloud TTS | <https://cloud.google.com/text-to-speech/docs/reference/rest> | <https://cloud.google.com/text-to-speech/docs/list-voices-and-types> |
| Azure Speech | <https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech> | <https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts> |
| ElevenLabs | <https://elevenlabs.io/docs/api-reference/text-to-speech/convert> | <https://elevenlabs.io/docs/voices> |
| AWS Polly | <https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html> | <https://docs.aws.amazon.com/polly/latest/dg/voicelist.html> |
| OpenAI-compatible | <https://platform.openai.com/docs/api-reference/audio/createSpeech> | <https://platform.openai.com/docs/guides/text-to-speech#voice-options> |

The same docs are also available from buttons in the plugin settings tab.

## Metadata block format

The plugin prepends a callout block near the top of the note (after frontmatter if present). Metadata lines can be toggled in settings. The title is a clean timestamp. For example:

```markdown
> [!tts]+ 2026-02-17 15:42:10.321
> generated_at: 2026-02-17T14:42:10.321Z
> source_note: [[02 Projects/My Note]]
> provider: openai
> provider_name: OpenAI
> model: gpt-4o-mini-tts
> voice: shimmer
> format: mp3
> mime_type: audio/mpeg
> source_characters_sent: 2412
> provider_docs: https://platform.openai.com/docs/guides/text-to-speech
> voice_docs: https://platform.openai.com/docs/guides/text-to-speech#voice-options
> audio_file: ![[Attachments/TTS Audio/my-note-20260217-154210.mp3]]

```

## Build

```bash
npm ci
npm run build
```

Release assets expected by Obsidian:

- `manifest.json`
- `main.js`
- `styles.css`
# hermes-tts
