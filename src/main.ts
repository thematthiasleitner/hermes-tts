import {
  App,
  FuzzySuggestModal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
} from "obsidian";
import {
  DescribeVoicesCommand,
  PollyClient,
  SynthesizeSpeechCommand,
} from "@aws-sdk/client-polly";
import { Mp3Encoder } from "@breezystack/lamejs";
import { GoogleGenAI } from "@google/genai";

type ProviderId =
  | "openai"
  | "gemini"
  | "google-cloud"
  | "azure"
  | "elevenlabs"
  | "aws-polly"
  | "openai-compatible";

type AwsEngine = "standard" | "neural";
const METADATA_FIELD_IDS = [
  "generated_at",
  "source_note",
  "provider",
  "provider_name",
  "model",
  "voice",
  "format",
  "mime_type",
  "source_characters_sent",
  "provider_docs",
  "voice_docs",
  "audio_file",
] as const;
type MetadataFieldId = (typeof METADATA_FIELD_IDS)[number];

const METADATA_FIELD_LABELS: Record<MetadataFieldId, string> = {
  generated_at: "Generated at",
  source_note: "Source note",
  provider: "Provider id",
  provider_name: "Provider name",
  model: "Model",
  voice: "Voice",
  format: "Format",
  mime_type: "MIME type",
  source_characters_sent: "Source characters sent",
  provider_docs: "Provider docs",
  voice_docs: "Voice docs",
  audio_file: "Audio file embed",
};

interface VoiceOption {
  label: string;
  value: string;
}

interface AwsVoiceOption extends VoiceOption {
  supportedEngines: string[];
  languageCode: string;
  languageName: string;
}

interface NoteTtsAudioSettings {
  audioOutputFolder: string;
  provider: ProviderId;
  voicePrompt: string;
  includeFrontmatter: boolean;
  stripMarkdownFormatting: boolean;
  metadataEnabledFields: MetadataFieldId[];

  openaiApiKey: string;
  openaiModel: string;
  openaiVoice: string;

  geminiApiKey: string;
  geminiModel: string;
  geminiVoice: string;

  googleApiKey: string;
  googleLanguageCode: string;
  googleVoice: string;
  googleAvailableVoices: VoiceOption[];

  azureApiKey: string;
  azureRegion: string;
  azureVoice: string;
  azureAvailableVoices: VoiceOption[];

  elevenlabsApiKey: string;
  elevenlabsModel: string;
  elevenlabsVoice: string;
  elevenlabsAvailableVoices: VoiceOption[];

  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken: string;
  awsVoice: string;
  awsEngine: AwsEngine;
  awsLanguageCode: string;
  awsAvailableVoices: AwsVoiceOption[];

  openaiCompatApiKey: string;
  openaiCompatBaseUrl: string;
  openaiCompatModel: string;
  openaiCompatVoice: string;
}

interface GeneratedAudio {
  bytes: Uint8Array;
  extension: string;
  mimeType: string;
  model: string;
  voice: string;
}

interface ProviderDocs {
  label: string;
  apiDocsUrl: string;
  voiceDocsUrl: string;
}

interface ProviderBase {
  id: ProviderId;
  displayName: string;
  model: string;
  voice: string;
}

interface OpenAiCompatibleProvider extends ProviderBase {
  kind: "openai-compatible";
  baseUrl: string;
  apiKey: string;
}

interface GeminiProvider extends ProviderBase {
  kind: "gemini";
  apiKey: string;
}

interface GoogleCloudProvider extends ProviderBase {
  kind: "google-cloud";
  apiKey: string;
  languageCode: string;
}

interface AzureProvider extends ProviderBase {
  kind: "azure";
  apiKey: string;
  region: string;
}

interface ElevenLabsProvider extends ProviderBase {
  kind: "elevenlabs";
  apiKey: string;
  modelId: string;
}

interface AwsPollyProvider extends ProviderBase {
  kind: "aws-polly";
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  engine: AwsEngine;
  languageCode: string;
}

type ResolvedProvider =
  | OpenAiCompatibleProvider
  | GeminiProvider
  | GoogleCloudProvider
  | AzureProvider
  | ElevenLabsProvider
  | AwsPollyProvider;

const FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  "google-cloud": "Google Cloud TTS",
  azure: "Azure Speech",
  elevenlabs: "ElevenLabs",
  "aws-polly": "AWS Polly",
  "openai-compatible": "OpenAI Compatible",
};

const PROVIDER_DOCS: Record<ProviderId, ProviderDocs> = {
  openai: {
    label: "OpenAI",
    apiDocsUrl: "https://platform.openai.com/docs/guides/text-to-speech",
    voiceDocsUrl: "https://platform.openai.com/docs/guides/text-to-speech#voice-options",
  },
  gemini: {
    label: "Google Gemini",
    apiDocsUrl: "https://ai.google.dev/gemini-api/docs/speech-generation",
    voiceDocsUrl: "https://ai.google.dev/gemini-api/docs/speech-generation#voices",
  },
  "google-cloud": {
    label: "Google Cloud Text-to-Speech",
    apiDocsUrl: "https://cloud.google.com/text-to-speech/docs/reference/rest",
    voiceDocsUrl: "https://cloud.google.com/text-to-speech/docs/list-voices-and-types",
  },
  azure: {
    label: "Azure Speech",
    apiDocsUrl: "https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech",
    voiceDocsUrl: "https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts",
  },
  elevenlabs: {
    label: "ElevenLabs",
    apiDocsUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    voiceDocsUrl: "https://elevenlabs.io/docs/voices",
  },
  "aws-polly": {
    label: "AWS Polly",
    apiDocsUrl: "https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html",
    voiceDocsUrl: "https://docs.aws.amazon.com/polly/latest/dg/voicelist.html",
  },
  "openai-compatible": {
    label: "OpenAI-Compatible API",
    apiDocsUrl: "https://platform.openai.com/docs/api-reference/audio/createSpeech",
    voiceDocsUrl: "https://platform.openai.com/docs/guides/text-to-speech#voice-options",
  },
};

const OPENAI_MODELS: VoiceOption[] = [
  { label: "gpt-4o-mini-tts", value: "gpt-4o-mini-tts" },
  { label: "tts-1", value: "tts-1" },
  { label: "tts-1-hd", value: "tts-1-hd" },
];

const GEMINI_MODELS: VoiceOption[] = [
  { label: "gemini-2.5-flash-preview-tts", value: "gemini-2.5-flash-preview-tts" },
  { label: "gemini-2.5-pro-preview-tts", value: "gemini-2.5-pro-preview-tts" },
];

const OPENAI_VOICES: VoiceOption[] = [
  { label: "Alloy", value: "alloy" },
  { label: "Ash", value: "ash" },
  { label: "Ballad", value: "ballad" },
  { label: "Coral", value: "coral" },
  { label: "Echo", value: "echo" },
  { label: "Fable", value: "fable" },
  { label: "Onyx", value: "onyx" },
  { label: "Nova", value: "nova" },
  { label: "Sage", value: "sage" },
  { label: "Shimmer", value: "shimmer" },
  { label: "Verse", value: "verse" },
];

const GEMINI_VOICES: VoiceOption[] = [
  { label: "Zephyr", value: "Zephyr" },
  { label: "Puck", value: "Puck" },
  { label: "Charon", value: "Charon" },
  { label: "Kore", value: "Kore" },
  { label: "Fenrir", value: "Fenrir" },
  { label: "Leda", value: "Leda" },
  { label: "Orus", value: "Orus" },
  { label: "Aoede", value: "Aoede" },
  { label: "Callirrhoe", value: "Callirrhoe" },
  { label: "Autonoe", value: "Autonoe" },
  { label: "Enceladus", value: "Enceladus" },
  { label: "Iapetus", value: "Iapetus" },
  { label: "Umbriel", value: "Umbriel" },
  { label: "Algieba", value: "Algieba" },
  { label: "Despina", value: "Despina" },
  { label: "Erinome", value: "Erinome" },
];

const GOOGLE_FALLBACK_VOICES: VoiceOption[] = [
  { label: "en-US-Neural2-C", value: "en-US-Neural2-C" },
  { label: "en-US-Neural2-F", value: "en-US-Neural2-F" },
  { label: "en-US-Wavenet-D", value: "en-US-Wavenet-D" },
  { label: "en-GB-Neural2-A", value: "en-GB-Neural2-A" },
];

const AZURE_FALLBACK_VOICES: VoiceOption[] = [
  { label: "en-US-JennyNeural", value: "en-US-JennyNeural" },
  { label: "en-US-GuyNeural", value: "en-US-GuyNeural" },
  { label: "en-GB-SoniaNeural", value: "en-GB-SoniaNeural" },
  { label: "en-AU-NatashaNeural", value: "en-AU-NatashaNeural" },
];

const ELEVENLABS_FALLBACK_VOICES: VoiceOption[] = [
  { label: "Rachel", value: "21m00Tcm4TlvDq8ikWAM" },
  { label: "Domi", value: "AZnzlk1XvdvUeBnXmlld" },
  { label: "Bella", value: "EXAVITQu4vr4xnSDxMaL" },
  { label: "Antoni", value: "ErXwobaYiN019PkySvjV" },
  { label: "Elli", value: "MF3mGyEYCl7XYWbV9V6O" },
  { label: "Josh", value: "TxGEqnHWrfWFTfGW9XjX" },
  { label: "Arnold", value: "VR6AewLTigWG4xSOukaG" },
  { label: "Adam", value: "pNInz6obpgDQGcFmaJgB" },
  { label: "Sam", value: "yoZ06aMxZJJ28mfd3POQ" },
];

const AWS_FALLBACK_VOICES: AwsVoiceOption[] = [
  {
    label: "Joanna (US English)",
    value: "Joanna",
    languageCode: "en-US",
    languageName: "US English",
    supportedEngines: ["standard", "neural"],
  },
  {
    label: "Matthew (US English)",
    value: "Matthew",
    languageCode: "en-US",
    languageName: "US English",
    supportedEngines: ["neural"],
  },
  {
    label: "Amy (British English)",
    value: "Amy",
    languageCode: "en-GB",
    languageName: "British English",
    supportedEngines: ["standard", "neural"],
  },
  {
    label: "Aria (US English)",
    value: "Aria",
    languageCode: "en-US",
    languageName: "US English",
    supportedEngines: ["neural"],
  },
];

const DEFAULT_SETTINGS: NoteTtsAudioSettings = {
  audioOutputFolder: "Attachments/TTS Audio",
  provider: "openai",
  voicePrompt: "",
  includeFrontmatter: false,
  stripMarkdownFormatting: true,
  metadataEnabledFields: [...METADATA_FIELD_IDS],

  openaiApiKey: "",
  openaiModel: "gpt-4o-mini-tts",
  openaiVoice: "shimmer",

  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash-preview-tts",
  geminiVoice: "Zephyr",

  googleApiKey: "",
  googleLanguageCode: "en-US",
  googleVoice: "en-US-Neural2-C",
  googleAvailableVoices: GOOGLE_FALLBACK_VOICES,

  azureApiKey: "",
  azureRegion: "eastus",
  azureVoice: "en-US-JennyNeural",
  azureAvailableVoices: AZURE_FALLBACK_VOICES,

  elevenlabsApiKey: "",
  elevenlabsModel: "eleven_multilingual_v2",
  elevenlabsVoice: "21m00Tcm4TlvDq8ikWAM",
  elevenlabsAvailableVoices: ELEVENLABS_FALLBACK_VOICES,

  awsRegion: "us-east-1",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsSessionToken: "",
  awsVoice: "Joanna",
  awsEngine: "neural",
  awsLanguageCode: "en-US",
  awsAvailableVoices: AWS_FALLBACK_VOICES,

  openaiCompatApiKey: "",
  openaiCompatBaseUrl: "",
  openaiCompatModel: "",
  openaiCompatVoice: "alloy",
};

class MarkdownFileSuggestModal extends FuzzySuggestModal<TFile> {
  private didSelect = false;
  private readonly onSelect: (file: TFile | null) => void;

  constructor(app: App, onSelect: (file: TFile | null) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Select a markdown note...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.didSelect = true;
    this.onSelect(item);
  }

  onClose(): void {
    super.onClose();
    if (!this.didSelect) {
      this.onSelect(null);
    }
  }
}

export default class NoteTtsAudioPlugin extends Plugin {
  settings!: NoteTtsAudioSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "generate-current-note-audio",
      name: "Generate Hermes-TTS audio (current note)",
      callback: async () => {
        await this.generateForActiveNote();
      },
    });

    this.addCommand({
      id: "generate-picked-note-audio",
      name: "Generate Hermes-TTS audio (pick note)",
      callback: async () => {
        await this.generateForPickedNote();
      },
    });

    this.addRibbonIcon("audio-lines", "Generate Hermes-TTS audio", async () => {
      await this.generateForActiveNote();
    });

    this.addSettingTab(new NoteTtsAudioSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    this.settings.provider = this.ensureProviderId(this.settings.provider);
    this.settings.metadataEnabledFields = this.normalizeMetadataEnabledFields(
      this.settings.metadataEnabledFields,
    );
    this.settings.googleAvailableVoices = this.normalizeVoiceOptions(
      this.settings.googleAvailableVoices,
      GOOGLE_FALLBACK_VOICES,
    );
    this.settings.azureAvailableVoices = this.normalizeVoiceOptions(
      this.settings.azureAvailableVoices,
      AZURE_FALLBACK_VOICES,
    );
    this.settings.elevenlabsAvailableVoices = this.normalizeVoiceOptions(
      this.settings.elevenlabsAvailableVoices,
      ELEVENLABS_FALLBACK_VOICES,
    );
    this.settings.awsAvailableVoices = this.normalizeAwsVoiceOptions(
      this.settings.awsAvailableVoices,
      AWS_FALLBACK_VOICES,
    );

    this.ensureVoiceValue(
      this.settings.openaiVoice,
      (value) => {
        this.settings.openaiVoice = value;
      },
      OPENAI_VOICES,
    );
    this.ensureVoiceValue(
      this.settings.geminiVoice,
      (value) => {
        this.settings.geminiVoice = value;
      },
      GEMINI_VOICES,
    );
    this.ensureVoiceValue(
      this.settings.googleVoice,
      (value) => {
        this.settings.googleVoice = value;
      },
      this.settings.googleAvailableVoices,
    );
    this.ensureVoiceValue(
      this.settings.azureVoice,
      (value) => {
        this.settings.azureVoice = value;
      },
      this.settings.azureAvailableVoices,
    );
    this.ensureVoiceValue(
      this.settings.elevenlabsVoice,
      (value) => {
        this.settings.elevenlabsVoice = value;
      },
      this.settings.elevenlabsAvailableVoices,
    );
    this.ensureAwsVoiceValue();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private ensureProviderId(provider: unknown): ProviderId {
    const candidate = String(provider ?? "");
    if (
      candidate === "openai" ||
      candidate === "gemini" ||
      candidate === "google-cloud" ||
      candidate === "azure" ||
      candidate === "elevenlabs" ||
      candidate === "aws-polly" ||
      candidate === "openai-compatible"
    ) {
      return candidate;
    }
    return DEFAULT_SETTINGS.provider;
  }

  private normalizeVoiceOptions(value: unknown, fallback: VoiceOption[]): VoiceOption[] {
    if (!Array.isArray(value)) {
      return [...fallback];
    }

    const parsed = value
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const obj = entry as Record<string, unknown>;
        const label = typeof obj.label === "string" ? obj.label : "";
        const optionValue = typeof obj.value === "string" ? obj.value : "";
        if (!label || !optionValue) {
          return null;
        }
        return { label, value: optionValue };
      })
      .filter((entry): entry is VoiceOption => Boolean(entry));

    return parsed.length > 0 ? parsed : [...fallback];
  }

  private normalizeMetadataEnabledFields(value: unknown): MetadataFieldId[] {
    if (!Array.isArray(value)) {
      return [...METADATA_FIELD_IDS];
    }

    const normalized = value
      .map((entry) => String(entry))
      .filter((entry): entry is MetadataFieldId => METADATA_FIELD_IDS.includes(entry as MetadataFieldId));

    return normalized.length > 0 ? [...new Set(normalized)] : [...METADATA_FIELD_IDS];
  }

  isMetadataFieldEnabled(field: MetadataFieldId): boolean {
    return this.settings.metadataEnabledFields.includes(field);
  }

  setMetadataFieldEnabled(field: MetadataFieldId, enabled: boolean): void {
    const next = new Set(this.settings.metadataEnabledFields);
    if (enabled) {
      next.add(field);
    } else {
      next.delete(field);
    }
    this.settings.metadataEnabledFields = METADATA_FIELD_IDS.filter((id) => next.has(id));
  }

  private normalizeAwsVoiceOptions(value: unknown, fallback: AwsVoiceOption[]): AwsVoiceOption[] {
    if (!Array.isArray(value)) {
      return [...fallback];
    }

    const parsed = value
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const obj = entry as Record<string, unknown>;
        const label = typeof obj.label === "string" ? obj.label : "";
        const optionValue = typeof obj.value === "string" ? obj.value : "";
        const languageCode = typeof obj.languageCode === "string" ? obj.languageCode : "";
        const languageName = typeof obj.languageName === "string" ? obj.languageName : "";
        const supportedEngines = Array.isArray(obj.supportedEngines)
          ? obj.supportedEngines.filter((x): x is string => typeof x === "string")
          : [];

        if (!label || !optionValue) {
          return null;
        }

        return {
          label,
          value: optionValue,
          languageCode,
          languageName,
          supportedEngines,
        };
      })
      .filter((entry): entry is AwsVoiceOption => Boolean(entry));

    return parsed.length > 0 ? parsed : [...fallback];
  }

  private ensureVoiceValue(
    currentValue: string,
    setValue: (value: string) => void,
    options: VoiceOption[],
  ): void {
    if (options.find((voice) => voice.value === currentValue)) {
      return;
    }
    if (options.length > 0) {
      setValue(options[0].value);
    }
  }

  ensureAwsVoiceValue(): void {
    const options = this.getFilteredAwsVoiceOptions();
    if (options.find((voice) => voice.value === this.settings.awsVoice)) {
      return;
    }

    if (options.length > 0) {
      this.settings.awsVoice = options[0].value;
      return;
    }

    if (this.settings.awsAvailableVoices.length > 0) {
      this.settings.awsVoice = this.settings.awsAvailableVoices[0].value;
    }
  }

  getProviderDocs(provider: ProviderId): ProviderDocs {
    return PROVIDER_DOCS[provider];
  }

  getFilteredAwsVoiceOptions(): AwsVoiceOption[] {
    const selectedEngine = this.settings.awsEngine;
    return this.settings.awsAvailableVoices.filter((voice) => {
      if (!voice.supportedEngines || voice.supportedEngines.length === 0) {
        return true;
      }
      return voice.supportedEngines.includes(selectedEngine);
    });
  }

  async refreshGoogleVoices(): Promise<void> {
    const apiKey = this.settings.googleApiKey.trim();
    if (!apiKey) {
      throw new Error("Google API key is required to fetch voice list.");
    }

    const response = await requestUrl({
      url: `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(apiKey)}`,
      method: "GET",
    });

    if (response.status >= 400) {
      throw new Error(`Google voice list request failed with status ${response.status}.`);
    }

    const json = response.json as { voices?: Array<{ name?: string; languageCodes?: string[] }> };
    const voices = (json.voices ?? [])
      .map((voice) => {
        const name = voice.name ?? "";
        const lang = voice.languageCodes?.[0] ?? "";
        if (!name) {
          return null;
        }
        return {
          label: lang ? `${name} (${lang})` : name,
          value: name,
        };
      })
      .filter((voice): voice is VoiceOption => Boolean(voice))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (!voices.length) {
      throw new Error("Google returned no voices.");
    }

    this.settings.googleAvailableVoices = voices;
    this.ensureVoiceValue(
      this.settings.googleVoice,
      (value) => {
        this.settings.googleVoice = value;
      },
      voices,
    );
    await this.saveSettings();
  }

  async refreshAzureVoices(): Promise<void> {
    const apiKey = this.settings.azureApiKey.trim();
    const region = this.settings.azureRegion.trim();

    if (!apiKey || !region) {
      throw new Error("Azure API key and region are required to fetch voice list.");
    }

    const response = await requestUrl({
      url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });

    if (response.status >= 400) {
      throw new Error(`Azure voice list request failed with status ${response.status}.`);
    }

    const json = response.json as Array<{
      ShortName?: string;
      Locale?: string;
      Gender?: string;
      VoiceType?: string;
    }>;

    const voices = (Array.isArray(json) ? json : [])
      .map((voice) => {
        const shortName = voice.ShortName ?? "";
        if (!shortName) {
          return null;
        }

        const suffixParts = [voice.Locale, voice.Gender, voice.VoiceType].filter(
          (part): part is string => Boolean(part),
        );

        return {
          label: suffixParts.length > 0 ? `${shortName} (${suffixParts.join(", ")})` : shortName,
          value: shortName,
        };
      })
      .filter((voice): voice is VoiceOption => Boolean(voice))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (!voices.length) {
      throw new Error("Azure returned no voices.");
    }

    this.settings.azureAvailableVoices = voices;
    this.ensureVoiceValue(
      this.settings.azureVoice,
      (value) => {
        this.settings.azureVoice = value;
      },
      voices,
    );
    await this.saveSettings();
  }

  async refreshElevenLabsVoices(): Promise<void> {
    const apiKey = this.settings.elevenlabsApiKey.trim();
    if (!apiKey) {
      throw new Error("ElevenLabs API key is required to fetch voice list.");
    }

    const response = await requestUrl({
      url: "https://api.elevenlabs.io/v1/voices",
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (response.status >= 400) {
      throw new Error(`ElevenLabs voice list request failed with status ${response.status}.`);
    }

    const json = response.json as {
      voices?: Array<{ voice_id?: string; name?: string; category?: string }>;
    };

    const voices = (json.voices ?? [])
      .map((voice) => {
        const id = voice.voice_id ?? "";
        const name = voice.name ?? id;
        if (!id) {
          return null;
        }
        const label = voice.category ? `${name} (${voice.category})` : name;
        return {
          label,
          value: id,
        };
      })
      .filter((voice): voice is VoiceOption => Boolean(voice))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (!voices.length) {
      throw new Error("ElevenLabs returned no voices.");
    }

    this.settings.elevenlabsAvailableVoices = voices;
    this.ensureVoiceValue(
      this.settings.elevenlabsVoice,
      (value) => {
        this.settings.elevenlabsVoice = value;
      },
      voices,
    );
    await this.saveSettings();
  }

  async refreshAwsVoices(): Promise<void> {
    const region = this.settings.awsRegion.trim();
    const accessKeyId = this.settings.awsAccessKeyId.trim();
    const secretAccessKey = this.settings.awsSecretAccessKey.trim();

    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error("AWS region, access key, and secret key are required to fetch voice list.");
    }

    const client = new PollyClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: this.settings.awsSessionToken.trim() || undefined,
      },
    });

    const collected: AwsVoiceOption[] = [];
    let nextToken: string | undefined = undefined;

    do {
      const response = await client.send(
        new DescribeVoicesCommand({
          NextToken: nextToken,
          IncludeAdditionalLanguageCodes: true,
        }),
      );

      for (const voice of response.Voices ?? []) {
        if (!voice.Id || !voice.Name) {
          continue;
        }

        const language = voice.LanguageName ?? voice.LanguageCode ?? "";
        collected.push({
          label: `${voice.Name} (${language})`,
          value: voice.Id,
          languageCode: voice.LanguageCode ?? "",
          languageName: voice.LanguageName ?? "",
          supportedEngines: (voice.SupportedEngines ?? []).map((engine) => String(engine)),
        });
      }

      nextToken = response.NextToken;
    } while (nextToken);

    const voices = collected.sort((a, b) => a.label.localeCompare(b.label));
    if (!voices.length) {
      throw new Error("AWS Polly returned no voices.");
    }

    this.settings.awsAvailableVoices = voices;
    this.ensureAwsVoiceValue();
    await this.saveSettings();
  }

  private async generateForActiveNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a markdown note first.");
      return;
    }

    await this.generateForFile(activeFile);
  }

  private async generateForPickedNote(): Promise<void> {
    const file = await new Promise<TFile | null>((resolve) => {
      new MarkdownFileSuggestModal(this.app, resolve).open();
    });

    if (!file) {
      return;
    }

    await this.generateForFile(file);
  }

  private async generateForFile(file: TFile): Promise<void> {
    try {
      new Notice(`Generating TTS audio for ${file.basename}...`);

      const originalContent = await this.app.vault.read(file);
      const preparedText = this.prepareTextForTTS(originalContent);
      if (!preparedText.trim()) {
        throw new Error("The selected note has no readable text after preprocessing.");
      }

      const provider = this.resolveProvider();
      const { generated: rawGenerated, providerUsed } = await this.synthesizeWithFallback(
        preparedText,
        provider,
      );
      const generated = await this.ensureMp3Output(rawGenerated);
      const audioPath = await this.writeAudioFile(file, generated);
      await this.prependMetadataBlock(file, audioPath, providerUsed, generated, preparedText.length);

      new Notice(`TTS audio created and linked in ${file.basename}.`);
    } catch (error) {
      console.error("[hermes-tts] generation failed", error);
      new Notice(this.humanizeError(error), 8000);
    }
  }

  private prepareTextForTTS(content: string): string {
    let output = content;

    if (!this.settings.includeFrontmatter) {
      output = output.replace(FRONTMATTER_REGEX, "");
    }

    if (this.settings.stripMarkdownFormatting) {
      output = output
        .replace(/```[\s\S]*?```/g, "\n")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[\[([^\]]+)\]\]/g, "$1")
        .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^>+\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/\n{3,}/g, "\n\n");
    }

    return output.trim();
  }

  private resolveProvider(): ResolvedProvider {
    switch (this.settings.provider) {
      case "openai":
        return this.resolveOpenAiProvider();
      case "gemini":
        return this.resolveGeminiProvider();
      case "google-cloud":
        return this.resolveGoogleCloudProvider();
      case "azure":
        return this.resolveAzureProvider();
      case "elevenlabs":
        return this.resolveElevenLabsProvider();
      case "aws-polly":
        return this.resolveAwsProvider();
      case "openai-compatible":
      default:
        return this.resolveOpenAiCompatibleProvider();
    }
  }

  private resolveOpenAiProvider(): OpenAiCompatibleProvider {
    const apiKey = this.settings.openaiApiKey.trim();
    const model = this.settings.openaiModel.trim();
    const voice = this.settings.openaiVoice.trim();

    if (!apiKey) {
      throw new Error("OpenAI API key is required.");
    }
    if (!model) {
      throw new Error("OpenAI model is required.");
    }
    if (!voice) {
      throw new Error("OpenAI voice is required.");
    }

    return {
      id: "openai",
      kind: "openai-compatible",
      displayName: PROVIDER_LABELS.openai,
      model,
      voice,
      baseUrl: "https://api.openai.com/v1",
      apiKey,
    };
  }

  private resolveGeminiProvider(): GeminiProvider {
    const apiKey = this.settings.geminiApiKey.trim();
    const model = this.settings.geminiModel.trim();
    const voice = this.settings.geminiVoice.trim();

    if (!apiKey) {
      throw new Error("Gemini API key is required.");
    }
    if (!model) {
      throw new Error("Gemini model is required.");
    }
    if (!voice) {
      throw new Error("Gemini voice is required.");
    }

    return {
      id: "gemini",
      kind: "gemini",
      displayName: PROVIDER_LABELS.gemini,
      model,
      voice,
      apiKey,
    };
  }

  private resolveOpenAiCompatibleProvider(): OpenAiCompatibleProvider {
    const apiKey = this.settings.openaiCompatApiKey.trim();
    const model = this.settings.openaiCompatModel.trim();
    const voice = this.settings.openaiCompatVoice.trim();
    const baseUrl = this.trimTrailingSlash(this.settings.openaiCompatBaseUrl.trim());

    if (!baseUrl) {
      throw new Error("OpenAI-compatible base URL is required.");
    }
    if (!model) {
      throw new Error("OpenAI-compatible model is required.");
    }
    if (!voice) {
      throw new Error("OpenAI-compatible voice is required.");
    }
    if (!apiKey && !this.isLikelyLocalEndpoint(baseUrl)) {
      throw new Error("OpenAI-compatible API key is required.");
    }

    return {
      id: "openai-compatible",
      kind: "openai-compatible",
      displayName: PROVIDER_LABELS["openai-compatible"],
      model,
      voice,
      baseUrl,
      apiKey,
    };
  }

  private resolveGoogleCloudProvider(): GoogleCloudProvider {
    const apiKey = this.settings.googleApiKey.trim();
    const languageCode = this.settings.googleLanguageCode.trim();
    const voice = this.settings.googleVoice.trim();

    if (!apiKey) {
      throw new Error("Google Cloud API key is required.");
    }
    if (!languageCode) {
      throw new Error("Google Cloud language code is required.");
    }
    if (!voice) {
      throw new Error("Google Cloud voice is required.");
    }

    return {
      id: "google-cloud",
      kind: "google-cloud",
      displayName: PROVIDER_LABELS["google-cloud"],
      model: "google-cloud-tts",
      voice,
      apiKey,
      languageCode,
    };
  }

  private resolveAzureProvider(): AzureProvider {
    const apiKey = this.settings.azureApiKey.trim();
    const region = this.settings.azureRegion.trim();
    const voice = this.settings.azureVoice.trim();

    if (!apiKey) {
      throw new Error("Azure API key is required.");
    }
    if (!region) {
      throw new Error("Azure region is required.");
    }
    if (!voice) {
      throw new Error("Azure voice is required.");
    }

    return {
      id: "azure",
      kind: "azure",
      displayName: PROVIDER_LABELS.azure,
      model: "azure-speech",
      voice,
      apiKey,
      region,
    };
  }

  private resolveElevenLabsProvider(): ElevenLabsProvider {
    const apiKey = this.settings.elevenlabsApiKey.trim();
    const modelId = this.settings.elevenlabsModel.trim();
    const voice = this.settings.elevenlabsVoice.trim();

    if (!apiKey) {
      throw new Error("ElevenLabs API key is required.");
    }
    if (!modelId) {
      throw new Error("ElevenLabs model ID is required.");
    }
    if (!voice) {
      throw new Error("ElevenLabs voice ID is required.");
    }

    return {
      id: "elevenlabs",
      kind: "elevenlabs",
      displayName: PROVIDER_LABELS.elevenlabs,
      model: modelId,
      voice,
      apiKey,
      modelId,
    };
  }

  private resolveAwsProvider(): AwsPollyProvider {
    const region = this.settings.awsRegion.trim();
    const accessKeyId = this.settings.awsAccessKeyId.trim();
    const secretAccessKey = this.settings.awsSecretAccessKey.trim();
    const voice = this.settings.awsVoice.trim();
    const languageCode = this.settings.awsLanguageCode.trim();

    if (!region) {
      throw new Error("AWS region is required.");
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS access key and secret access key are required.");
    }
    if (!voice) {
      throw new Error("AWS Polly voice is required.");
    }

    return {
      id: "aws-polly",
      kind: "aws-polly",
      displayName: PROVIDER_LABELS["aws-polly"],
      model: `polly-${this.settings.awsEngine}`,
      voice,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken: this.settings.awsSessionToken.trim(),
      engine: this.settings.awsEngine,
      languageCode,
    };
  }

  private async synthesize(text: string, provider: ResolvedProvider): Promise<GeneratedAudio> {
    switch (provider.kind) {
      case "openai-compatible":
        return this.synthesizeWithOpenAiCompatible(text, provider);
      case "gemini":
        return this.synthesizeWithGemini(text, provider);
      case "google-cloud":
        return this.synthesizeWithGoogleCloud(text, provider);
      case "azure":
        return this.synthesizeWithAzure(text, provider);
      case "elevenlabs":
        return this.synthesizeWithElevenLabs(text, provider);
      case "aws-polly":
      default:
        return this.synthesizeWithAwsPolly(text, provider);
    }
  }

  private async synthesizeWithFallback(
    text: string,
    provider: ResolvedProvider,
  ): Promise<{ generated: GeneratedAudio; providerUsed: ResolvedProvider }> {
    try {
      return {
        generated: await this.synthesize(text, provider),
        providerUsed: provider,
      };
    } catch (error) {
      if (!this.shouldFallbackGeminiToGoogle(provider, error)) {
        throw error;
      }

      let fallbackProvider: GoogleCloudProvider;
      try {
        fallbackProvider = this.resolveGoogleCloudProvider();
      } catch (fallbackSetupError) {
        throw new Error(
          `Gemini TTS failed (${this.humanizeError(error)}). Google Cloud fallback is not configured: ${this.humanizeError(
            fallbackSetupError,
          )}`,
        );
      }

      new Notice("Gemini TTS failed. Retrying with Google Cloud fallback...");
      try {
        const generated = await this.synthesizeWithGoogleCloud(text, fallbackProvider);
        new Notice("Google Cloud fallback succeeded.");
        return { generated, providerUsed: fallbackProvider };
      } catch (fallbackError) {
        throw new Error(
          `Gemini TTS failed (${this.humanizeError(error)}). Google Cloud fallback also failed: ${this.humanizeError(
            fallbackError,
          )}`,
        );
      }
    }
  }

  private shouldFallbackGeminiToGoogle(provider: ResolvedProvider, error: unknown): boolean {
    if (provider.kind !== "gemini") {
      return false;
    }

    if (!this.settings.googleApiKey.trim()) {
      return false;
    }

    const message = this.humanizeError(error).toLowerCase();
    if (!message.includes("gemini tts request failed")) {
      return false;
    }

    return (
      message.includes("(429)") ||
      message.includes("(400)") ||
      message.includes("(500)") ||
      message.includes("(502)") ||
      message.includes("(503)") ||
      message.includes("(504)") ||
      message.includes("internal error") ||
      message.includes("model tried to generate text") ||
      message.includes("only be used for tts")
    );
  }

  private async synthesizeWithOpenAiCompatible(
    text: string,
    provider: OpenAiCompatibleProvider,
  ): Promise<GeneratedAudio> {
    if (provider.id === "openai" && text.length > 4096) {
      return this.synthesizeLongOpenAiInput(text, provider);
    }

    return this.requestOpenAiCompatibleSpeech(text, provider);
  }

  private async synthesizeLongOpenAiInput(
    text: string,
    provider: OpenAiCompatibleProvider,
  ): Promise<GeneratedAudio> {
    const chunks = this.splitTextForGemini(text, 3900);
    if (!chunks.length) {
      throw new Error("OpenAI request payload is empty after chunking.");
    }

    const monoChunks: Float32Array[] = [];
    let totalSamples = 0;
    let sampleRate = 44100;

    for (const chunk of chunks) {
      const generated = await this.requestOpenAiCompatibleSpeech(chunk, provider);
      const mp3 = await this.ensureMp3Output(generated);
      const audioBuffer = await this.decodeAudioBytes(mp3.bytes);
      const mono = this.downmixToMono(audioBuffer);
      sampleRate = audioBuffer.sampleRate;
      monoChunks.push(mono);
      totalSamples += mono.length;
    }

    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of monoChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const pcm16 = this.floatToInt16Pcm(merged);
    const mp3Bytes = this.encodeMonoPcm16ToMp3(pcm16, sampleRate, 128);

    return {
      bytes: mp3Bytes,
      extension: "mp3",
      mimeType: "audio/mpeg",
      model: provider.model,
      voice: provider.voice,
    };
  }

  private async requestOpenAiCompatibleSpeech(
    text: string,
    provider: OpenAiCompatibleProvider,
  ): Promise<GeneratedAudio> {
    const responseFormat = "mp3";
    const urls = this.getOpenAiSpeechUrls(provider.baseUrl);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      model: provider.model,
      input: text,
      voice: provider.voice,
      response_format: responseFormat,
    };

    const voicePrompt = this.getVoicePrompt();
    if (
      voicePrompt &&
      provider.id === "openai" &&
      this.openAiModelSupportsInstructions(provider.model)
    ) {
      payload.instructions = voicePrompt;
    }

    const body = JSON.stringify(payload);

    const errors: string[] = [];

    for (const url of urls) {
      let response;
      try {
        response = await requestUrl({
          url,
          method: "POST",
          headers,
          body,
        });
      } catch (error) {
        errors.push(`${url} -> ${this.humanizeError(error)}`);
        continue;
      }

      if (response.status >= 400) {
        errors.push(`${url} -> HTTP ${response.status}`);
        // Some providers require /v1/audio/speech while others use /audio/speech.
        // Retry alternative URL forms only for route-mismatch-like responses.
        if ((response.status === 404 || response.status === 405) && urls.length > 1) {
          continue;
        }
        throw new Error(
          `OpenAI-compatible TTS request failed at ${url} with status ${response.status}: ${response.text ?? ""}`,
        );
      }

      return {
        bytes: new Uint8Array(response.arrayBuffer),
        extension: "mp3",
        mimeType: "audio/mpeg",
        model: provider.model,
        voice: provider.voice,
      };
    }

    throw new Error(
      `OpenAI-compatible TTS request failed. Tried: ${urls.join(", ")}. Results: ${errors.join("; ")}`,
    );
  }

  private async synthesizeWithGemini(text: string, provider: GeminiProvider): Promise<GeneratedAudio> {
    const ai = new GoogleGenAI({ apiKey: provider.apiKey });
    const instructions = this.getVoicePrompt();

    try {
      const pcmBytes = await this.requestGeminiPcm(ai, provider, text, instructions);
      const wavBytes = this.wrapPcm16AsWav(pcmBytes, 24000, 1, 16);
      return {
        bytes: wavBytes,
        extension: "wav",
        mimeType: "audio/wav",
        model: provider.model,
        voice: provider.voice,
      };
    } catch (error) {
      const mapped = this.mapGeminiSdkError(error);
      if (!this.isGeminiTextInsteadOfAudioError(mapped.message)) {
        throw mapped;
      }

      const chunks = this.splitTextForGemini(text, 900);
      if (!chunks.length) {
        throw mapped;
      }

      new Notice("Gemini requested stricter transcript format. Retrying with segmented transcript...");

      const pcmChunks: Uint8Array[] = [];
      let totalLength = 0;
      let contextBefore = "";

      for (const chunk of chunks) {
        let chunkPcm: Uint8Array;
        try {
          chunkPcm = await this.requestGeminiPcm(ai, provider, chunk, instructions, contextBefore);
        } catch (chunkError) {
          const mappedChunk = this.mapGeminiSdkError(chunkError);
          if (!instructions || !this.isGeminiTextInsteadOfAudioError(mappedChunk.message)) {
            throw mappedChunk;
          }

          // Retry the chunk once without style instructions to keep Gemini in strict TTS mode.
          chunkPcm = await this.requestGeminiPcm(ai, provider, chunk, "", contextBefore);
        }

        pcmChunks.push(chunkPcm);
        totalLength += chunkPcm.length;
        contextBefore = this.buildGeminiContextWindow(contextBefore, chunk, 2000);
      }

      const mergedPcm = this.concatChunks(pcmChunks, totalLength);
      const wavBytes = this.wrapPcm16AsWav(mergedPcm, 24000, 1, 16);

      return {
        bytes: wavBytes,
        extension: "wav",
        mimeType: "audio/wav",
        model: provider.model,
        voice: provider.voice,
      };
    }
  }

  private async requestGeminiPcm(
    ai: GoogleGenAI,
    provider: GeminiProvider,
    text: string,
    voicePrompt: string,
    textBefore = "",
  ): Promise<Uint8Array> {
    const prompt = this.buildGeminiSpeechPrompt(text, voicePrompt, textBefore);
    const response = await ai.models.generateContent({
      model: provider.model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: provider.voice
          ? {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: provider.voice,
                },
              },
            }
          : undefined,
      },
    });

    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const generation = part?.inlineData?.data;
      if (generation) {
        return this.base64ToUint8Array(generation);
      }
    }

    const textPart = parts.find((part) => typeof part?.text === "string" && part.text.trim().length > 0);
    if (textPart?.text) {
      throw new Error(`Gemini response returned text instead of audio: ${textPart.text.trim()}`);
    }

    throw new Error("Gemini response missing audio data.");
  }

  private async synthesizeWithGoogleCloud(
    text: string,
    provider: GoogleCloudProvider,
  ): Promise<GeneratedAudio> {
    const encoding = "MP3";

    let response;
    try {
      response = await requestUrl({
        url: `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(
          provider.apiKey,
        )}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: provider.languageCode,
            name: provider.voice,
          },
          audioConfig: {
            audioEncoding: encoding,
          },
        }),
      });
    } catch (error) {
      throw new Error(`Google Cloud TTS request failed: ${this.humanizeError(error)}`);
    }

    if (response.status >= 400) {
      throw new Error(`Google Cloud TTS request returned status ${response.status}: ${response.text ?? ""}`);
    }

    const json = response.json as { audioContent?: string; error?: { message?: string } };
    if (!json?.audioContent) {
      throw new Error(
        `Google Cloud TTS response missing audio content: ${json?.error?.message ?? "unknown error"}`,
      );
    }

    const extension = encoding === "MP3" ? "mp3" : "ogg";
    const mimeType = encoding === "MP3" ? "audio/mpeg" : "audio/ogg";

    return {
      bytes: this.base64ToUint8Array(json.audioContent),
      extension,
      mimeType,
      model: provider.model,
      voice: provider.voice,
    };
  }

  private async synthesizeWithAzure(text: string, provider: AzureProvider): Promise<GeneratedAudio> {
    const outputFormat = "audio-24khz-96kbitrate-mono-mp3";
    const escapedText = this.escapeXml(text);
    const locale = this.inferAzureLocaleFromVoice(provider.voice);

    const ssml = [
      `<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"${locale}\">`,
      `<voice name=\"${provider.voice}\">`,
      escapedText,
      `</voice>`,
      `</speak>`,
    ].join("");

    let response;
    try {
      response = await requestUrl({
        url: `https://${provider.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": provider.apiKey,
          "X-Microsoft-OutputFormat": outputFormat,
          "Content-Type": "application/ssml+xml",
          "User-Agent": "obsidian-hermes-tts",
        },
        body: ssml,
      });
    } catch (error) {
      throw new Error(`Azure TTS request failed: ${this.humanizeError(error)}`);
    }

    if (response.status >= 400) {
      throw new Error(`Azure TTS request returned status ${response.status}: ${response.text ?? ""}`);
    }

    const extension = outputFormat.includes("mp3") ? "mp3" : "ogg";
    const mimeType = extension === "mp3" ? "audio/mpeg" : "audio/ogg";

    return {
      bytes: new Uint8Array(response.arrayBuffer),
      extension,
      mimeType,
      model: provider.model,
      voice: provider.voice,
    };
  }

  private async synthesizeWithElevenLabs(
    text: string,
    provider: ElevenLabsProvider,
  ): Promise<GeneratedAudio> {
    const outputFormat = "mp3_44100_128";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      provider.voice,
    )}?output_format=${encodeURIComponent(outputFormat)}`;

    let response;
    try {
      response = await requestUrl({
        url,
        method: "POST",
        headers: {
          "xi-api-key": provider.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: provider.modelId,
        }),
      });
    } catch (error) {
      throw new Error(`ElevenLabs TTS request failed: ${this.humanizeError(error)}`);
    }

    if (response.status >= 400) {
      throw new Error(`ElevenLabs TTS request returned status ${response.status}: ${response.text ?? ""}`);
    }

    return {
      bytes: new Uint8Array(response.arrayBuffer),
      extension: "mp3",
      mimeType: "audio/mpeg",
      model: provider.model,
      voice: provider.voice,
    };
  }

  private async synthesizeWithAwsPolly(text: string, provider: AwsPollyProvider): Promise<GeneratedAudio> {
    const outputFormat = "mp3";

    const client = new PollyClient({
      region: provider.region,
      credentials: {
        accessKeyId: provider.accessKeyId,
        secretAccessKey: provider.secretAccessKey,
        sessionToken: provider.sessionToken || undefined,
      },
    });

    let result;
    try {
      result = await client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          OutputFormat: outputFormat,
          VoiceId: provider.voice as any,
          Engine: provider.engine,
          LanguageCode: (provider.languageCode || undefined) as any,
          TextType: "text",
        }),
      );
    } catch (error) {
      throw new Error(`AWS Polly request failed: ${this.humanizeError(error)}`);
    }

    const bytes = await this.awsStreamToBytes(result.AudioStream);
    if (!bytes.length) {
      throw new Error("AWS Polly returned an empty audio stream.");
    }

    return {
      bytes,
      extension: "mp3",
      mimeType: "audio/mpeg",
      model: provider.model,
      voice: provider.voice,
    };
  }

  private async ensureMp3Output(generated: GeneratedAudio): Promise<GeneratedAudio> {
    const extension = generated.extension.trim().toLowerCase();
    const mimeType = generated.mimeType.trim().toLowerCase();
    if (extension === "mp3" && mimeType === "audio/mpeg") {
      return generated;
    }

    const audioBuffer = await this.decodeAudioBytes(generated.bytes);
    const mono = this.downmixToMono(audioBuffer);
    const pcm16 = this.floatToInt16Pcm(mono);
    const mp3Bytes = this.encodeMonoPcm16ToMp3(pcm16, audioBuffer.sampleRate, 128);

    return {
      ...generated,
      bytes: mp3Bytes,
      extension: "mp3",
      mimeType: "audio/mpeg",
    };
  }

  private async decodeAudioBytes(bytes: Uint8Array): Promise<AudioBuffer> {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Audio conversion to mp3 requires AudioContext support.");
    }

    const context: AudioContext = new AudioContextCtor();
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    try {
      return await context.decodeAudioData(copy);
    } catch (error) {
      throw new Error(`Failed to decode audio for mp3 conversion: ${this.humanizeError(error)}`);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private downmixToMono(buffer: AudioBuffer): Float32Array {
    const channelCount = buffer.numberOfChannels;
    if (channelCount <= 0) {
      return new Float32Array(0);
    }
    if (channelCount === 1) {
      return buffer.getChannelData(0).slice();
    }

    const mixed = new Float32Array(buffer.length);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const data = buffer.getChannelData(channelIndex);
      for (let i = 0; i < data.length; i += 1) {
        mixed[i] += data[i];
      }
    }

    const divisor = 1 / channelCount;
    for (let i = 0; i < mixed.length; i += 1) {
      mixed[i] *= divisor;
    }

    return mixed;
  }

  private floatToInt16Pcm(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
    return output;
  }

  private encodeMonoPcm16ToMp3(samples: Int16Array, sampleRate: number, bitrateKbps: number): Uint8Array {
    const safeRate = Math.max(8000, Math.round(sampleRate));
    const encoder = new Mp3Encoder(1, safeRate, bitrateKbps);
    const chunkSize = 1152;
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    for (let i = 0; i < samples.length; i += chunkSize) {
      const frame = samples.subarray(i, i + chunkSize);
      const encoded = encoder.encodeBuffer(frame) as Int8Array | Uint8Array;
      if (encoded && encoded.length > 0) {
        const bytes = Uint8Array.from(encoded);
        chunks.push(bytes);
        totalLength += bytes.length;
      }
    }

    const flush = encoder.flush() as Int8Array | Uint8Array;
    if (flush && flush.length > 0) {
      const bytes = Uint8Array.from(flush);
      chunks.push(bytes);
      totalLength += bytes.length;
    }

    if (totalLength === 0) {
      throw new Error("Mp3 conversion produced an empty output.");
    }

    return this.concatChunks(chunks, totalLength);
  }

  private async writeAudioFile(file: TFile, generated: GeneratedAudio): Promise<string> {
    const folder = normalizePath(this.settings.audioOutputFolder.trim() || DEFAULT_SETTINGS.audioOutputFolder);
    await this.ensureFolderExists(folder);

    const safePrefix = this.slugify(file.basename);
    const timestamp = this.formatFileTimestamp(new Date());

    let candidate = normalizePath(`${folder}/${safePrefix}-${timestamp}.${generated.extension}`);
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${safePrefix}-${timestamp}-${counter}.${generated.extension}`);
      counter += 1;
    }

    const binary = Uint8Array.from(generated.bytes);
    await this.app.vault.createBinary(candidate, binary.buffer);
    return candidate;
  }

  private async prependMetadataBlock(
    file: TFile,
    audioPath: string,
    provider: ResolvedProvider,
    generated: GeneratedAudio,
    sourceCharacters: number,
  ): Promise<void> {
    const latestContent = await this.app.vault.read(file);
    const now = new Date();
    const wikiNotePath = file.path.replace(/\.md$/i, "");
    const docs = this.getProviderDocs(provider.id);

    const lines = [`> [!tts]+ ${this.formatMetadataTitleTimestamp(now)}`];
    this.pushMetadataLine(lines, "generated_at", now.toISOString());
    this.pushMetadataLine(lines, "source_note", `[[${wikiNotePath}]]`);
    this.pushMetadataLine(lines, "provider", provider.id);
    this.pushMetadataLine(lines, "provider_name", provider.displayName);
    this.pushMetadataLine(lines, "model", generated.model);
    this.pushMetadataLine(lines, "voice", generated.voice);
    this.pushMetadataLine(lines, "format", generated.extension);
    this.pushMetadataLine(lines, "mime_type", generated.mimeType);
    this.pushMetadataLine(lines, "source_characters_sent", String(sourceCharacters));
    this.pushMetadataLine(lines, "provider_docs", docs.apiDocsUrl);
    this.pushMetadataLine(lines, "voice_docs", docs.voiceDocsUrl);
    this.pushMetadataLine(lines, "audio_file", `![[${audioPath}]]`);
    lines.push("", "");
    const block = lines.join("\n");

    const updated = this.insertNearTop(latestContent, block);
    await this.app.vault.modify(file, updated);
  }

  private pushMetadataLine(lines: string[], field: MetadataFieldId, value: string): void {
    if (!this.isMetadataFieldEnabled(field)) {
      return;
    }
    lines.push(`> ${field}: ${value}`);
  }

  private insertNearTop(content: string, block: string): string {
    const frontmatterMatch = content.match(FRONTMATTER_REGEX);
    if (!frontmatterMatch) {
      return `${block}${content}`;
    }

    const end = frontmatterMatch[0].length;
    return `${content.slice(0, end)}\n${block}${content.slice(end)}`;
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized) {
      return;
    }

    const segments = normalized.split("/").filter((part) => part.length > 0);
    let cursor = "";

    for (const segment of segments) {
      cursor = cursor ? `${cursor}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(cursor)) {
        await this.app.vault.createFolder(cursor);
      }
    }
  }

  private getOpenAiSpeechUrls(baseUrl: string): string[] {
    const trimmed = this.trimTrailingSlash(baseUrl);
    const urls = [`${trimmed}/audio/speech`];

    const lower = trimmed.toLowerCase();
    const hasExplicitV1 = lower.endsWith("/v1") || lower.includes("/v1/");
    if (!hasExplicitV1) {
      urls.push(`${trimmed}/v1/audio/speech`);
    }

    return [...new Set(urls)];
  }

  private getVoicePrompt(): string {
    return this.settings.voicePrompt.trim();
  }

  private buildGeminiSpeechPrompt(text: string, voicePrompt: string, textBefore = ""): string {
    const sections: string[] = [];
    const trimmedVoicePrompt = voicePrompt.trim();
    const trimmedTextBefore = textBefore.trim();
    const transcript = text.trim();

    if (trimmedVoicePrompt) {
      sections.push(`Style notes: ${trimmedVoicePrompt}`);
    }

    if (trimmedTextBefore) {
      sections.push(
        `Previous transcript context for continuity (do not repeat this context):\n${trimmedTextBefore}`,
      );
    }

    sections.push(`Narrate this transcript exactly as written:\n${transcript}`);
    return sections.join("\n\n");
  }

  private isGeminiTextInsteadOfAudioError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("model tried to generate text") ||
      normalized.includes("only be used for tts") ||
      normalized.includes("only generate audio")
    );
  }

  private splitTextForGemini(text: string, maxChunkSize: number): string[] {
    const cleaned = text.trim();
    if (!cleaned) {
      return [];
    }

    const paragraphs = cleaned
      .split(/\n\s*\n/g)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    const chunks: string[] = [];
    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxChunkSize) {
        chunks.push(paragraph);
        continue;
      }

      const sentenceParts = paragraph
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      if (!sentenceParts.length) {
        for (let i = 0; i < paragraph.length; i += maxChunkSize) {
          chunks.push(paragraph.slice(i, i + maxChunkSize));
        }
        continue;
      }

      let current = "";
      for (const sentence of sentenceParts) {
        if (sentence.length > maxChunkSize) {
          if (current) {
            chunks.push(current);
            current = "";
          }
          for (let i = 0; i < sentence.length; i += maxChunkSize) {
            chunks.push(sentence.slice(i, i + maxChunkSize));
          }
          continue;
        }

        const candidate = current ? `${current} ${sentence}` : sentence;
        if (candidate.length <= maxChunkSize) {
          current = candidate;
        } else {
          if (current) {
            chunks.push(current);
          }
          current = sentence;
        }
      }

      if (current) {
        chunks.push(current);
      }
    }

    return chunks;
  }

  private buildGeminiContextWindow(existing: string, nextChunk: string, maxChars: number): string {
    const combined = existing ? `${existing}\n${nextChunk}` : nextChunk;
    if (combined.length <= maxChars) {
      return combined;
    }
    return combined.slice(combined.length - maxChars);
  }

  private mapGeminiSdkError(error: unknown): Error {
    const original = this.humanizeError(error);
    const status = this.extractGeminiHttpStatus(original);
    const message = this.extractGeminiJsonErrorMessage(original) || original;

    if (status !== null) {
      return new Error(`Gemini TTS request failed (${status}): ${message}`);
    }

    return new Error(`Gemini TTS request failed: ${message}`);
  }

  private extractGeminiHttpStatus(message: string): number | null {
    const gotStatusMatch = message.match(/got status:\s*(\d{3})/i);
    if (gotStatusMatch) {
      const status = Number(gotStatusMatch[1]);
      if (Number.isFinite(status)) {
        return status;
      }
    }

    const parentheticalMatch = message.match(/\((\d{3})\)/);
    if (parentheticalMatch) {
      const status = Number(parentheticalMatch[1]);
      if (Number.isFinite(status)) {
        return status;
      }
    }

    const parsed = this.parseGeminiErrorJson(message);
    const status = Number(parsed?.error?.code);
    if (Number.isFinite(status)) {
      return status;
    }

    return null;
  }

  private extractGeminiJsonErrorMessage(message: string): string | null {
    const parsed = this.parseGeminiErrorJson(message);
    const apiMessage = parsed?.error?.message;
    if (typeof apiMessage === "string" && apiMessage.trim().length > 0) {
      return apiMessage.trim();
    }

    return null;
  }

  private parseGeminiErrorJson(message: string): { error?: { code?: unknown; message?: unknown } } | null {
    const jsonStart = message.indexOf("{");
    if (jsonStart === -1) {
      return null;
    }

    const jsonStr = message.slice(jsonStart).trim();
    try {
      return JSON.parse(jsonStr) as { error?: { code?: unknown; message?: unknown } };
    } catch {
      return null;
    }
  }

  private wrapPcm16AsWav(
    pcmBytes: Uint8Array,
    sampleRate: number,
    channels: number,
    bitDepth = 16,
  ): Uint8Array {
    const blockAlign = (channels * bitDepth) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmBytes.byteLength;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let offset = 0;
    const writeAscii = (value: string): void => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
      offset += value.length;
    };

    writeAscii("RIFF");
    view.setUint32(offset, totalSize - 8, true);
    offset += 4;
    writeAscii("WAVE");
    writeAscii("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, channels, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, byteRate, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, bitDepth, true);
    offset += 2;
    writeAscii("data");
    view.setUint32(offset, dataSize, true);
    offset += 4;

    new Uint8Array(buffer, headerSize).set(pcmBytes);
    return new Uint8Array(buffer);
  }

  private trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
  }

  private formatFileTimestamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
      date.getHours(),
    )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  private formatMetadataTitleTimestamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const millis = date.getMilliseconds().toString().padStart(3, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${millis}`;
  }

  private slugify(input: string): string {
    const cleaned = input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();

    return cleaned || "note-audio";
  }

  private isLikelyLocalEndpoint(url: string): boolean {
    return /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(url);
  }

  private openAiModelSupportsInstructions(model: string): boolean {
    const normalized = model.trim().toLowerCase();
    return normalized === "gpt-4o-mini-tts" || normalized.startsWith("gpt-4o-mini-tts-");
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const sanitized = base64.replace(/\s/g, "");
    if (typeof atob === "function") {
      const binary = atob(sanitized);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    const buffer = Buffer.from(sanitized, "base64");
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private inferAzureLocaleFromVoice(voiceName: string): string {
    const match = voiceName.match(/^[a-z]{2,3}-[A-Z]{2,4}/);
    return match ? match[0] : "en-US";
  }

  private async awsStreamToBytes(stream: unknown): Promise<Uint8Array> {
    if (!stream) {
      return new Uint8Array(0);
    }

    const candidate = stream as any;

    if (typeof candidate.transformToByteArray === "function") {
      const bytes = await candidate.transformToByteArray();
      return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    }

    if (candidate instanceof Uint8Array) {
      return candidate;
    }

    if (candidate instanceof ArrayBuffer) {
      return new Uint8Array(candidate);
    }

    if (ArrayBuffer.isView(candidate)) {
      return new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength);
    }

    if (typeof candidate.getReader === "function") {
      const reader = candidate.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }

        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        chunks.push(chunk);
        totalLength += chunk.length;
      }

      return this.concatChunks(chunks, totalLength);
    }

    if (candidate && typeof candidate[Symbol.asyncIterator] === "function") {
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      for await (const chunkValue of candidate as AsyncIterable<any>) {
        const chunk =
          chunkValue instanceof Uint8Array
            ? chunkValue
            : chunkValue instanceof ArrayBuffer
              ? new Uint8Array(chunkValue)
              : ArrayBuffer.isView(chunkValue)
                ? new Uint8Array(
                    chunkValue.buffer,
                    chunkValue.byteOffset,
                    chunkValue.byteLength,
                  )
                : new Uint8Array(0);

        if (chunk.length > 0) {
          chunks.push(chunk);
          totalLength += chunk.length;
        }
      }

      return this.concatChunks(chunks, totalLength);
    }

    throw new Error("Unsupported AWS Polly audio stream type.");
  }

  private concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined;
  }

  private humanizeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error);
  }
}

class NoteTtsAudioSettingTab extends PluginSettingTab {
  plugin: NoteTtsAudioPlugin;

  constructor(app: App, plugin: NoteTtsAudioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("hermes-tts-setting-tab");

    this.section(
      "Output",
      "Generated audio is always saved as mp3. Long notes are handled automatically.",
    );

    new Setting(containerEl)
      .setName("Audio output folder")
      .setDesc("Folder for generated audio files.")
      .addText((text) =>
        text
          .setPlaceholder("Attachments/TTS Audio")
          .setValue(this.plugin.settings.audioOutputFolder)
          .onChange(async (value) => {
            this.plugin.settings.audioOutputFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Include frontmatter")
      .setDesc("If disabled, YAML frontmatter is excluded from spoken text.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeFrontmatter).onChange(async (value) => {
          this.plugin.settings.includeFrontmatter = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Strip markdown formatting")
      .setDesc("Removes markdown syntax before sending text to TTS.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripMarkdownFormatting)
          .onChange(async (value) => {
            this.plugin.settings.stripMarkdownFormatting = value;
            await this.plugin.saveSettings();
          }),
      );

    this.section("Metadata", "Choose which metadata lines appear in the tts callout.");
    this.displayMetadataSettings(containerEl);

    this.section("Voice Prompt", "Optional speaking-style guidance for supported providers.");

    new Setting(containerEl)
      .setName("Voice prompt")
      .setDesc(
        "Optional speaking-style instructions. Used by Gemini and by OpenAI when model supports instructions (gpt-4o-mini-tts).",
      )
      .addTextArea((textArea) =>
        textArea
          .setPlaceholder("Example: Calm, warm, and concise with short pauses between sections.")
          .setValue(this.plugin.settings.voicePrompt)
          .onChange(async (value) => {
            this.plugin.settings.voicePrompt = value;
            await this.plugin.saveSettings();
          }),
      );

    this.section("Model Provider", "Configure one provider at a time.");

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Select the provider used for synthesis.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai", PROVIDER_LABELS.openai)
          .addOption("gemini", PROVIDER_LABELS.gemini)
          .addOption("google-cloud", PROVIDER_LABELS["google-cloud"])
          .addOption("azure", PROVIDER_LABELS.azure)
          .addOption("elevenlabs", PROVIDER_LABELS.elevenlabs)
          .addOption("aws-polly", PROVIDER_LABELS["aws-polly"])
          .addOption("openai-compatible", PROVIDER_LABELS["openai-compatible"])
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as ProviderId;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    this.providerDocsSetting(containerEl, this.plugin.settings.provider);

    switch (this.plugin.settings.provider) {
      case "openai":
        this.displayOpenAiSettings(containerEl);
        break;
      case "gemini":
        this.displayGeminiSettings(containerEl);
        break;
      case "google-cloud":
        this.displayGoogleCloudSettings(containerEl);
        break;
      case "azure":
        this.displayAzureSettings(containerEl);
        break;
      case "elevenlabs":
        this.displayElevenLabsSettings(containerEl);
        break;
      case "aws-polly":
        this.displayAwsPollySettings(containerEl);
        break;
      case "openai-compatible":
      default:
        this.displayOpenAiCompatibleSettings(containerEl);
        break;
    }
  }

  private displayMetadataSettings(containerEl: HTMLElement): void {
    for (const field of METADATA_FIELD_IDS) {
      new Setting(containerEl)
        .setName(METADATA_FIELD_LABELS[field])
        .setDesc(`Include \`${field}\` in metadata.`)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.isMetadataFieldEnabled(field)).onChange(async (value) => {
            this.plugin.setMetadataFieldEnabled(field, value);
            await this.plugin.saveSettings();
          }),
        );
    }
  }

  private providerDocsSetting(containerEl: HTMLElement, provider: ProviderId): void {
    const docs = this.plugin.getProviderDocs(provider);

    new Setting(containerEl)
      .setName(`${docs.label} documentation`)
      .setDesc("Open official API and voice documentation.")
      .addButton((button) =>
        button.setButtonText("API docs").onClick(() => {
          if (typeof window !== "undefined") {
            window.open(docs.apiDocsUrl, "_blank", "noopener,noreferrer");
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("Voice docs").onClick(() => {
          if (typeof window !== "undefined") {
            window.open(docs.voiceDocsUrl, "_blank", "noopener,noreferrer");
          }
        }),
      );
  }

  private displayOpenAiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Get one from https://platform.openai.com/api-keys")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    this.dropdownSetting(
      containerEl,
      "Model",
      "OpenAI TTS model.",
      OPENAI_MODELS,
      this.plugin.settings.openaiModel,
      async (value) => {
        this.plugin.settings.openaiModel = value;
        await this.plugin.saveSettings();
      },
    );

    this.dropdownSetting(
      containerEl,
      "Voice",
      "OpenAI voice.",
      OPENAI_VOICES,
      this.plugin.settings.openaiVoice,
      async (value) => {
        this.plugin.settings.openaiVoice = value;
        await this.plugin.saveSettings();
      },
    );
  }

  private displayGeminiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Gemini API key")
      .setDesc("Get one from https://aistudio.google.com/apikey")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("AIza...")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    this.dropdownSetting(
      containerEl,
      "Model",
      "Gemini TTS model.",
      GEMINI_MODELS,
      this.plugin.settings.geminiModel,
      async (value) => {
        this.plugin.settings.geminiModel = value;
        await this.plugin.saveSettings();
      },
    );

    this.dropdownSetting(
      containerEl,
      "Voice",
      "Gemini voice.",
      GEMINI_VOICES,
      this.plugin.settings.geminiVoice,
      async (value) => {
        this.plugin.settings.geminiVoice = value;
        await this.plugin.saveSettings();
      },
    );
  }

  private displayGoogleCloudSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Google Cloud API key")
      .setDesc("Enable Cloud Text-to-Speech API and use an API key with access.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("AIza...")
          .setValue(this.plugin.settings.googleApiKey)
          .onChange(async (value) => {
            this.plugin.settings.googleApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Language code")
      .setDesc("Example: en-US")
      .addText((text) =>
        text.setValue(this.plugin.settings.googleLanguageCode).onChange(async (value) => {
          this.plugin.settings.googleLanguageCode = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    this.dropdownSetting(
      containerEl,
      "Voice",
      "Google Cloud voice. Click refresh to load all available voices.",
      this.plugin.settings.googleAvailableVoices,
      this.plugin.settings.googleVoice,
      async (value) => {
        this.plugin.settings.googleVoice = value;
        await this.plugin.saveSettings();
      },
    );

    this.refreshVoicesSetting(containerEl, "Refresh Google voices", async () => {
      await this.plugin.refreshGoogleVoices();
    });
  }

  private displayAzureSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Azure API key")
      .setDesc("Azure Speech resource key.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("Azure key")
          .setValue(this.plugin.settings.azureApiKey)
          .onChange(async (value) => {
            this.plugin.settings.azureApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Azure region")
      .setDesc("Example: eastus")
      .addText((text) =>
        text.setValue(this.plugin.settings.azureRegion).onChange(async (value) => {
          this.plugin.settings.azureRegion = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    this.dropdownSetting(
      containerEl,
      "Voice",
      "Azure voice. Click refresh to load all available voices in your region.",
      this.plugin.settings.azureAvailableVoices,
      this.plugin.settings.azureVoice,
      async (value) => {
        this.plugin.settings.azureVoice = value;
        await this.plugin.saveSettings();
      },
    );

    this.refreshVoicesSetting(containerEl, "Refresh Azure voices", async () => {
      await this.plugin.refreshAzureVoices();
    });
  }

  private displayElevenLabsSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("ElevenLabs API key")
      .setDesc("Get one from https://elevenlabs.io/")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("xi-...")
          .setValue(this.plugin.settings.elevenlabsApiKey)
          .onChange(async (value) => {
            this.plugin.settings.elevenlabsApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model ID")
      .setDesc("Example: eleven_multilingual_v2")
      .addText((text) =>
        text.setValue(this.plugin.settings.elevenlabsModel).onChange(async (value) => {
          this.plugin.settings.elevenlabsModel = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    this.dropdownSetting(
      containerEl,
      "Voice",
      "ElevenLabs voice ID. Click refresh to load voices from your account.",
      this.plugin.settings.elevenlabsAvailableVoices,
      this.plugin.settings.elevenlabsVoice,
      async (value) => {
        this.plugin.settings.elevenlabsVoice = value;
        await this.plugin.saveSettings();
      },
    );

    this.refreshVoicesSetting(containerEl, "Refresh ElevenLabs voices", async () => {
      await this.plugin.refreshElevenLabsVoices();
    });
  }

  private displayAwsPollySettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("AWS region")
      .setDesc("Example: us-east-1")
      .addText((text) =>
        text.setValue(this.plugin.settings.awsRegion).onChange(async (value) => {
          this.plugin.settings.awsRegion = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("AWS access key ID")
      .addText((text) =>
        text.setValue(this.plugin.settings.awsAccessKeyId).onChange(async (value) => {
          this.plugin.settings.awsAccessKeyId = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("AWS secret access key")
      .addText((text) => {
        text.inputEl.type = "password";
        return text.setValue(this.plugin.settings.awsSecretAccessKey).onChange(async (value) => {
          this.plugin.settings.awsSecretAccessKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("AWS session token")
      .setDesc("Optional, for temporary credentials.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text.setValue(this.plugin.settings.awsSessionToken).onChange(async (value) => {
          this.plugin.settings.awsSessionToken = value.trim();
          await this.plugin.saveSettings();
        });
      });

    this.dropdownSetting(
      containerEl,
      "Engine",
      "Polly engine.",
      [
        { label: "standard", value: "standard" },
        { label: "neural", value: "neural" },
      ],
      this.plugin.settings.awsEngine,
      async (value) => {
        this.plugin.settings.awsEngine = value as AwsEngine;
        this.plugin.ensureAwsVoiceValue();
        await this.plugin.saveSettings();
        this.display();
      },
    );

    new Setting(containerEl)
      .setName("Language code")
      .setDesc("Optional, example: en-US")
      .addText((text) =>
        text.setValue(this.plugin.settings.awsLanguageCode).onChange(async (value) => {
          this.plugin.settings.awsLanguageCode = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    const filteredVoices = this.plugin.getFilteredAwsVoiceOptions();
    this.dropdownSetting(
      containerEl,
      "Voice",
      "AWS Polly voice. Click refresh to load all voices from your account region.",
      filteredVoices,
      this.plugin.settings.awsVoice,
      async (value) => {
        this.plugin.settings.awsVoice = value;
        await this.plugin.saveSettings();
      },
    );

    this.refreshVoicesSetting(containerEl, "Refresh AWS Polly voices", async () => {
      await this.plugin.refreshAwsVoices();
    });
  }

  private displayOpenAiCompatibleSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("API key")
      .setDesc("Bearer token for your OpenAI-compatible endpoint.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("Bearer token")
          .setValue(this.plugin.settings.openaiCompatApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiCompatApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("Example: https://api.example.com or https://api.example.com/v1")
      .addText((text) =>
        text.setValue(this.plugin.settings.openaiCompatBaseUrl).onChange(async (value) => {
          this.plugin.settings.openaiCompatBaseUrl = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model value sent to /audio/speech.")
      .addText((text) =>
        text.setValue(this.plugin.settings.openaiCompatModel).onChange(async (value) => {
          this.plugin.settings.openaiCompatModel = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    this.dropdownSetting(
      containerEl,
      "Voice",
      "Voice parameter sent to /audio/speech.",
      OPENAI_VOICES,
      this.plugin.settings.openaiCompatVoice,
      async (value) => {
        this.plugin.settings.openaiCompatVoice = value;
        await this.plugin.saveSettings();
      },
    );
  }

  private dropdownSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    options: VoiceOption[],
    value: string,
    onChange: (value: string) => Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addDropdown((dropdown) => {
        const safeOptions = options.length > 0 ? options : [{ label: "No options", value: "" }];

        for (const option of safeOptions) {
          dropdown.addOption(option.value, option.label);
        }

        const fallbackValue = safeOptions[0]?.value ?? "";
        dropdown.setValue(
          safeOptions.some((option) => option.value === value) ? value : fallbackValue,
        );

        dropdown.onChange(async (nextValue) => {
          await onChange(nextValue);
        });
      });
  }

  private refreshVoicesSetting(
    containerEl: HTMLElement,
    label: string,
    refreshFn: () => Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(label)
      .setDesc("Fetch the latest provider voice list into this dropdown.")
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(async () => {
          const defaultText = button.buttonEl.textContent ?? "Refresh";
          button.setDisabled(true);
          button.setButtonText("Refreshing...");

          try {
            await refreshFn();
            new Notice("Voice list refreshed.");
            this.display();
          } catch (error) {
            new Notice(`Voice refresh failed: ${this.humanizeError(error)}`, 7000);
          } finally {
            button.setDisabled(false);
            button.setButtonText(defaultText);
          }
        }),
      );
  }

  private humanizeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error);
  }

  private section(title: string, description?: string): void {
    const heading = new Setting(this.containerEl).setName(title).setHeading();
    if (description) {
      heading.setDesc(description);
    }
  }
}
