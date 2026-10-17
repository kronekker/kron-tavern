import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DatabaseService } from '../database/database.service.js';

export type ModelCategoryType = 'chat' | 'text-to-image' | 'image-to-image' | 'video' | 'voice' | 'other';

export interface DefaultModelsConfig {
  chatModel: string;
  textToImageModel: string;
  imageToImageModel: string;
}

export interface UserPreferredModels {
  chatModel?: string | null;
  textToImageModel?: string | null;
  imageToImageModel?: string | null;
}

export interface ResolvedActiveModels {
  system: DefaultModelsConfig;
  user: UserPreferredModels;
  effective: DefaultModelsConfig;
  resolved: {
    chat: ModelSummary | null;
    textToImage: ModelSummary | null;
    imageToImage: ModelSummary | null;
  };
}

export interface BillingMethodSpec {
  name: string;
  category: 'Fixed-Rate' | 'Usage-Based' | 'Special' | 'Standard';
  description: string;
}

export const BILLING_METHODS_REFERENCE: Record<string, BillingMethodSpec> = {
  cpr: {
    name: 'Per Request',
    category: 'Fixed-Rate',
    description: 'Fixed cost per run, regardless of output. Most common for image generation, image editing, and simple models.',
  },
  cps: {
    name: 'Per Second',
    category: 'Fixed-Rate',
    description: 'Cost per second of processing time. When no dynamic pricing is set, this is the default: cost = elapsed seconds × cps rate.',
  },
  cpo: {
    name: 'Per Output',
    category: 'Fixed-Rate',
    description: 'Cost per output item generated. Multiple files = pay per file. If no output, base price charged once.',
  },
  cpt: {
    name: 'Per Token',
    category: 'Fixed-Rate',
    description: 'Cost per token used. Total tokens (input + output) extracted from model usage metadata. Primarily used for LLM models.',
  },
  'cp-pixel': {
    name: 'Per Pixel',
    category: 'Usage-Based',
    description: 'Cost based on output resolution. Each 1,048,576 pixels (1024×1024) = one tier. Can include per-input-image costs.',
  },
  'cp-audiosecondslength': {
    name: 'Per Audio Second',
    category: 'Usage-Based',
    description: 'Cost per second of input audio duration measured via ffprobe.',
  },
  'cp-promptlength': {
    name: 'Per Character',
    category: 'Usage-Based',
    description: 'Cost per character in input prompt: total cost = prompt length × price.',
  },
  'cp-outputVideoLength': {
    name: 'Per Video Second',
    category: 'Usage-Based',
    description: 'Cost per second of generated output video measured via ffprobe.',
  },
  'cp-realtimeturn': {
    name: 'Per Realtime Turn',
    category: 'Special',
    description: 'For realtime voice models: billing per conversation turn deducted in real time during the session.',
  },
  'cp-readoutput': {
    name: 'Model-Reported Tokens',
    category: 'Special',
    description: 'The model reports its own cost in stdout/stderr metadata. Commonly token-based input/output rates for partner LLMs.',
  },
  cp: {
    name: 'Per Unit',
    category: 'Standard',
    description: 'Standard unit billing for specialized workflows.',
  },
};

export interface PricingTier {
  inputs: Record<string, any>;
  inputsDescription: string;
  price: number;
  priceFormatted: string;
  priceMethod: string;
  priceMethodName: string;
  priceExtra?: number;
  priceInput?: number;
  note?: string;
}

export interface ModelPricingInfo {
  billingType: 'flat' | 'tiered' | 'token-based' | 'approximate' | 'per-second' | 'unlisted';
  headlineBadge: string;
  subtext: string;
  primaryMethodCode: string;
  primaryMethodName: string;
  primaryMethodExplanation: string;
  isDynamic: boolean;
  isApproximate: boolean;
  approximateCost: number | null;
  cpsRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  tiers: PricingTier[];
  tokenPricingNote: string | null;
}

export interface LocalLlmConfig {
  enabled: boolean;
  modelsUrl: string;
}

export interface LocalLlmStatusResponse {
  config: LocalLlmConfig;
  online: boolean;
  models: ModelSummary[];
  error?: string | null;
  lastChecked: string | null;
}

export interface ModelSummary {
  id: string;
  title: string;
  slug: string;
  slugowner: string;
  slugproject: string;
  description: string;
  image: string | null;
  categories: string[];
  type: ModelCategoryType;
  computingtime: string | null;
  hasParameters: boolean;
  priority: number;
  pricing: ModelPricingInfo;
  isLocal?: boolean;
  localEndpoint?: string;
}

export const DEFAULT_SELECTED_CATEGORIES: string[] = [
  'partner-llm',
  'llm',
  'llm-reasoning',
  'chat',
  'text-to-image',
  'image-to-image',
  'image-editing',
  'image-to-video',
  'text-to-video',
];

export const ALL_KNOWN_WIRO_CATEGORIES: string[] = [
  'partner-llm',
  'llm',
  'llm-reasoning',
  'chat',
  'text-to-image',
  'image-to-image',
  'image-editing',
  'image-to-video',
  'text-to-video',
  '3d-generation',
  'audio',
  'speech-to-speech',
  'speech-to-text',
  'text-to-audio',
  'text-to-music',
  'text-to-song',
  'text-to-speech',
  'video-to-video',
  'voice-agent',
  'voice-clone',
  'whisper',
  'ocr',
  'translate',
  'use-agent',
  'utils',
  'deepseek',
  'openai',
  'qwen',
  'xai',
  'google',
  'alibaba',
  'ByteDance',
  'elevenlabs',
  'ideogram',
  'klingai',
  'PixVerse',
];

export interface ModelCatalogStats {
  total: number;
  lastUpdated: string | null;
  selectedCategories: string[];
  breakdown: Record<ModelCategoryType, number>;
  localModelsCount?: number;
  localOnline?: boolean;
}

export interface CachedModelDetailResponse {
  success: boolean;
  fromCache: boolean;
  cachedAt: string;
  filePath: string;
  detail: any;
  pricing: ModelPricingInfo;
}

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);
  private readonly catalogPath: string;
  private readonly rawPath: string;
  private readonly modelsDir: string;

  private cachedSummaries: ModelSummary[] = [];
  private cachedRawTools: Map<string, any> = new Map();
  private lastUpdated: string | null = null;
  private selectedCategories: string[] = [...DEFAULT_SELECTED_CATEGORIES];

  // Local llama.cpp state
  public readonly DEFAULT_LOCAL_LLM_CONFIG: LocalLlmConfig = {
    enabled: true,
    modelsUrl: 'http://localhost:8080/models',
  };
  private localModels: ModelSummary[] = [];
  private localRawData: Map<string, any> = new Map();
  private localOnline = false;
  private localError: string | null = null;
  private localLastChecked: string | null = null;
  private localLastCheckedMs = 0;

  constructor(private readonly dbService: DatabaseService) {
    const isInsideServer = existsSync(resolve(process.cwd(), 'nest-cli.json'));
    const rootDir = isInsideServer ? resolve(process.cwd(), '..') : process.cwd();
    const dataDir = resolve(rootDir, 'data');
    this.catalogPath = resolve(dataDir, 'wiro-models-catalog.json');
    this.rawPath = resolve(dataDir, 'wiro-models.json');
    this.modelsDir = resolve(dataDir, 'models');

    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true });
    }
  }

  async onModuleInit() {
    this.loadFromDisk();
    await this.syncLocalModels();
  }

  loadFromDisk() {
    try {
      // Load selectedCategories from catalog cache if it exists
      if (existsSync(this.catalogPath)) {
        try {
          const content = JSON.parse(readFileSync(this.catalogPath, 'utf-8'));
          this.lastUpdated = content.lastUpdated || null;
          if (Array.isArray(content.selectedCategories) && content.selectedCategories.length > 0) {
            this.selectedCategories = content.selectedCategories;
          }
          if (!existsSync(this.rawPath) && Array.isArray(content.models)) {
            this.cachedSummaries = content.models;
            this.logger.log(
              `Loaded ${this.cachedSummaries.length} model summaries from ${this.catalogPath}`,
            );
            return;
          }
        } catch {}
      }

      // Index from raw wiro-models.json so pricing rules are always up-to-date
      if (existsSync(this.rawPath)) {
        this.logger.log(`Indexing raw models from ${this.rawPath}...`);
        const rawContent = JSON.parse(readFileSync(this.rawPath, 'utf-8'));
        const tools = rawContent.tool || [];
        this.indexAndSaveCatalog(tools);
        return;
      }

      this.logger.warn('No Wiro models catalog found on disk yet. Ready for admin refresh.');
    } catch (err: any) {
      this.logger.error(`Error loading Wiro models: ${err.message}`);
    }
  }

  // --- Local llama.cpp Discovery & Management ---

  getLocalLlmConfig(): LocalLlmConfig {
    const saved = this.dbService.getSetting<Partial<LocalLlmConfig>>(
      'local_llm_config',
      this.DEFAULT_LOCAL_LLM_CONFIG,
    );
    return {
      enabled: saved.enabled !== undefined ? Boolean(saved.enabled) : true,
      modelsUrl: saved.modelsUrl?.trim() || this.DEFAULT_LOCAL_LLM_CONFIG.modelsUrl,
    };
  }

  getLocalLlmBaseUrl(): string {
    const { modelsUrl } = this.getLocalLlmConfig();
    return modelsUrl
      .replace(/\/v1\/models\/?$/i, '')
      .replace(/\/models\/?$/i, '')
      .replace(/\/+$/, '');
  }

  async setLocalLlmConfig(update: Partial<LocalLlmConfig>): Promise<LocalLlmStatusResponse> {
    const current = this.getLocalLlmConfig();
    const next: LocalLlmConfig = {
      enabled: update.enabled !== undefined ? Boolean(update.enabled) : current.enabled,
      modelsUrl: update.modelsUrl?.trim() || current.modelsUrl,
    };
    this.dbService.setSetting('local_llm_config', next);
    this.logger.log(`Updated local llama.cpp configuration: ${JSON.stringify(next)}`);
    return await this.syncLocalModels();
  }

  async syncLocalModels(): Promise<LocalLlmStatusResponse> {
    const config = this.getLocalLlmConfig();
    this.localLastChecked = new Date().toISOString();
    this.localLastCheckedMs = Date.now();

    if (!config.enabled) {
      this.localModels = [];
      this.localRawData.clear();
      this.localOnline = false;
      this.localError = null;
      return this.getLocalLlmStatus();
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(config.modelsUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${config.modelsUrl}`);
      }

      const data = await res.json();
      const dataList: any[] = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
          ? data.models
          : [];

      const modelsMap = new Map<string, any>();
      if (Array.isArray(data?.models)) {
        for (const m of data.models) {
          const key = m.model || m.name || m.id;
          if (key) modelsMap.set(String(key), m);
        }
      }

      const discovered: ModelSummary[] = [];
      this.localRawData.clear();

      for (const item of dataList) {
        const rawId = String(item.id || item.model || item.name || '').trim();
        if (!rawId) continue;

        const extraInfo = modelsMap.get(rawId) || {};
        const meta = item.meta || {};
        const shortTitle = rawId.includes('/') ? rawId.split('/').pop()! : rawId;
        const paramsB = meta.n_params ? `${(Number(meta.n_params) / 1e9).toFixed(1)}B params` : '';
        const ctxK = meta.n_ctx ? `${Math.round(Number(meta.n_ctx) / 1024)}K ctx` : '';
        const quant =
          meta.ftype ||
          extraInfo?.details?.quantization_level ||
          (rawId.includes(':') ? rawId.split(':').pop() : 'GGUF');
        const specParts = [paramsB, ctxK, quant].filter(Boolean).join(' • ');

        const slug = `llamacpp/${rawId}`;
        const summary: ModelSummary = {
          id: `local:${rawId}`,
          title: `🖥️ ${shortTitle}`,
          slug,
          slugowner: 'llamacpp',
          slugproject: rawId,
          description: `Locally hosted LLM running via llama.cpp at ${config.modelsUrl}${specParts ? ' (' + specParts + ')' : ''}. Full model ID: ${rawId}`,
          image: null,
          categories: ['llm', 'chat', 'local-llamacpp'],
          type: 'chat',
          computingtime: 'Local Workstation',
          hasParameters: false,
          priority: 1000,
          isLocal: true,
          localEndpoint: config.modelsUrl,
          pricing: {
            billingType: 'flat',
            headlineBadge: '🖥️ $0.00 (Local)',
            subtext: specParts ? `Local llama.cpp • ${specParts}` : 'Free • Local llama.cpp',
            primaryMethodCode: 'local',
            primaryMethodName: 'Local Workstation',
            primaryMethodExplanation:
              'Executed locally on this workstation via llama.cpp. Zero token or API charges.',
            isDynamic: false,
            isApproximate: false,
            approximateCost: 0,
            cpsRate: 0,
            minPrice: 0,
            maxPrice: 0,
            tiers: [
              {
                inputs: {},
                inputsDescription: `Local llama.cpp (${config.modelsUrl})`,
                price: 0,
                priceFormatted: '$0.00 (Local Workstation)',
                priceMethod: 'local',
                priceMethodName: 'Local llama.cpp',
                note: `Model: ${rawId}${specParts ? ' • ' + specParts : ''}`,
              },
            ],
            tokenPricingNote: 'Hosted locally via llama.cpp on this workstation — $0.00 per token.',
          },
        };

        discovered.push(summary);
        this.localRawData.set(rawId, { ...item, extraInfo, endpoint: config.modelsUrl });
      }

      this.localModels = discovered;
      this.localOnline = true;
      this.localError = null;
      this.logger.log(
        `Discovered ${discovered.length} local llama.cpp model(s) from ${config.modelsUrl}`,
      );
    } catch (err: any) {
      this.localOnline = false;
      this.localError = err.message || 'Could not reach local llama.cpp server';
      this.logger.warn(`Local llama.cpp check at ${config.modelsUrl}: ${this.localError}`);
    }

    return this.getLocalLlmStatus();
  }

  getLocalLlmStatus(): LocalLlmStatusResponse {
    return {
      config: this.getLocalLlmConfig(),
      online: this.localOnline,
      models: this.localModels,
      error: this.localError,
      lastChecked: this.localLastChecked,
    };
  }

  isLocalLlmModel(modelIdOrSlug?: string | null): boolean {
    if (!modelIdOrSlug) return false;
    const clean = modelIdOrSlug.trim();
    const lower = clean.toLowerCase();
    if (lower.startsWith('llamacpp/') || lower.startsWith('local:') || lower.startsWith('local/')) {
      return true;
    }
    return this.localModels.some(
      (m) =>
        m.id.toLowerCase() === lower ||
        m.slug.toLowerCase() === lower ||
        m.slugproject.toLowerCase() === lower ||
        m.title.toLowerCase() === lower,
    );
  }

  resolveLocalModelId(modelIdOrSlug: string): string {
    const clean = modelIdOrSlug.trim();
    const stripped = clean
      .replace(/^llamacpp\//i, '')
      .replace(/^local:/i, '')
      .replace(/^local\//i, '');

    // If stripped matches a discovered local model, return its exact rawId
    const found = this.localModels.find(
      (m) =>
        m.slugproject.toLowerCase() === stripped.toLowerCase() ||
        m.slug.toLowerCase() === clean.toLowerCase() ||
        m.id.toLowerCase() === clean.toLowerCase(),
    );
    if (found) return found.slugproject;

    // If stripped is 'default' and we have at least one local model, use the first one
    if (stripped.toLowerCase() === 'default' && this.localModels.length > 0) {
      return this.localModels[0].slugproject;
    }

    return stripped;
  }

  private formatInputsDescription(inputs: Record<string, any>): string {
    if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
      return 'Default / All Configurations';
    }
    return Object.entries(inputs)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' • ');
  }

  private formatCompactPriceNumber(val: number): string {
    if (val === 0) return '0';
    if (val >= 1) return Number.isInteger(val) ? String(val) : val.toFixed(2).replace(/\.?0+$/, '');
    if (val >= 0.01) return val.toFixed(4).replace(/\.?0+$/, '');
    return val.toFixed(5).replace(/\.?0+$/, '');
  }

  private extractCostFromReadOutputNote(note?: string | null): {
    headlineBadge: string;
    subtext: string;
    priceFormatted: string;
    minPrice: number;
    maxPrice: number;
  } {
    if (!note || !note.trim()) {
      return {
        headlineBadge: '💬 Token / Metered',
        subtext: 'Model-Reported Usage',
        priceFormatted: 'Metered per run',
        minPrice: 0,
        maxPrice: 0,
      };
    }

    const n = note.replace(/\r?\n/g, ' ').trim();

    // 1. Text + Image token pricing: "text input $5 / 1M tokens, image input $8 / 1M tokens, image output $30 / 1M tokens"
    let m = n.match(
      /text input \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M tokens,\s*image input \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M tokens,\s*image output \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M/i,
    );
    if (m) {
      const badge = `In: $${m[1]} (Img $${m[2]}) • Out: $${m[3]} / 1M`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens (Text & Image)',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[3]),
      };
    }

    // 2. Multimodal input + text/image output: "input (text/image/video/PDF) $1.50 per 1M tokens, text and thinking output $7.50 per 1M tokens, image output $30 per 1M tokens"
    m = n.match(
      /input[^$]*\$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M tokens,\s*text and thinking output \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M tokens(?:,\s*image output \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M)?/i,
    );
    if (m) {
      const badge = m[3]
        ? `In: $${m[1]} • Out: $${m[2]} (Img $${m[3]}) / 1M`
        : `In: $${m[1]} • Out: $${m[2]} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[3] || m[2]),
      };
    }

    // 3. Standard "input $X per 1M tokens, output $Y per 1M tokens"
    m = n.match(
      /input \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M tokens,\s*output \$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*1M tokens/i,
    );
    if (m) {
      const badge = `In: $${m[1]} • Out: $${m[2]} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[2]),
      };
    }

    // 4. "$X per 1M input tokens ... $Y per 1M output tokens"
    m = n.match(
      /\$([0-9]+(?:\.[0-9]+)?)\s*per 1M input tokens.*?\$([0-9]+(?:\.[0-9]+)?)\s*per 1M output tokens/i,
    );
    if (m) {
      const badge = `In: $${m[1]} • Out: $${m[2]} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[2]),
      };
    }

    // 5. "$X (...) for 1m input tokens ... $Y for 1m output tokens"
    m = n.match(
      /\$([0-9]+(?:\.[0-9]+)?)\s*(?:\([^)]+\)\s*)?for 1m input tokens.*?\$([0-9]+(?:\.[0-9]+)?)\s*for 1m output tokens/i,
    );
    if (m) {
      const badge = `In: $${m[1]} • Out: $${m[2]} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[2]),
      };
    }

    // 6. "1 million input token $X, 1 million output token $Y"
    m = n.match(
      /1 million input token \$([0-9]+(?:\.[0-9]+)?),\s*1 million output token \$([0-9]+(?:\.[0-9]+)?)/i,
    );
    if (m) {
      const badge = `In: $${m[1]} • Out: $${m[2]} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[2]),
      };
    }

    // 7. "$X input (...), $Y output"
    m = n.match(
      /\$([0-9]+(?:\.[0-9]+)?)\s*input(?:\s*\([^)]*\))?,\s*(?:\$[0-9.]+\s*cached input,\s*)?\$([0-9]+(?:\.[0-9]+)?)\s*output/i,
    );
    if (m) {
      const badge = `In: $${m[1]} • Out: $${m[2]} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[2]),
      };
    }

    // 8. "Input: $X ... Output: $Y" (flat or tiered)
    m = n.match(
      /Input:\s*\$([0-9]+(?:\.[0-9]+)?)(?:\s*\([^)]*\))?(?:\s*\/\s*\$([0-9]+(?:\.[0-9]+)?))?.*?Output:\s*\$([0-9]+(?:\.[0-9]+)?)(?:\s*\([^)]*\))?(?:\s*\/\s*\$([0-9]+(?:\.[0-9]+)?))?/i,
    );
    if (m) {
      const inStr = m[2] ? `$${m[1]}–$${m[2]}` : `$${m[1]}`;
      const outStr = m[4] ? `$${m[3]}–$${m[4]}` : `$${m[3]}`;
      const badge = `In: ${inStr} • Out: ${outStr} / 1M tok`;
      return {
        headlineBadge: `💬 ${badge}`,
        subtext: m[2] || m[4] ? 'Tiered per 1M tokens' : 'Per 1M tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[4] || m[3]),
      };
    }

    // 9. Video tokens: "$X per 1000 tokens"
    m = n.match(/\$([0-9]+(?:\.[0-9]+)?)\s*per 1000 tokens/i);
    if (m) {
      const badge = `$${m[1]} / 1K tok`;
      return {
        headlineBadge: `🎬 ${badge}`,
        subtext: 'Video resolution × duration tokens',
        priceFormatted: badge,
        minPrice: parseFloat(m[1]),
        maxPrice: parseFloat(m[1]),
      };
    }

    // 10. Extract all dollar amounts in note (e.g. per-second or per-image tiered notes)
    const dollars = [...n.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)]
      .map((x) => parseFloat(x[1]))
      .filter((x) => !isNaN(x) && x > 0);
    if (dollars.length > 0) {
      const min = Math.min(...dollars);
      const max = Math.max(...dollars);
      const isPerSec = /per[- ]second|\/s\b|\/sec/i.test(n);
      const isPerImg = /garment|image|1K:|2K:/i.test(n);
      const unit = isPerSec ? 'sec' : isPerImg ? 'img' : 'run';
      const range = min === max ? `$${min}` : `$${min}–$${max}`;
      return {
        headlineBadge: `💰 ${range} / ${unit}`,
        subtext: isPerSec ? 'Metered per video second' : isPerImg ? 'Metered per image tier' : 'Metered usage rate',
        priceFormatted: `${range} / ${unit}`,
        minPrice: min,
        maxPrice: max,
      };
    }

    return {
      headlineBadge: '💬 Metered Token/Run',
      subtext: n.length > 55 ? n.slice(0, 52) + '...' : n,
      priceFormatted: 'Metered usage',
      minPrice: 0,
      maxPrice: 0,
    };
  }

  public parsePricingInfo(t: any): ModelPricingInfo {
    let dp = t.dynamicprice;
    if (typeof dp === 'string') {
      try {
        dp = JSON.parse(dp);
      } catch {
        dp = null;
      }
    }

    if (Array.isArray(dp) && dp.length > 0) {
      const readOutput = dp.find((d: any) => d.priceMethod === 'cp-readoutput');
      if (readOutput) {
        const spec = BILLING_METHODS_REFERENCE['cp-readoutput'];
        const extracted = this.extractCostFromReadOutputNote(readOutput.note);
        return {
          billingType: 'token-based',
          headlineBadge: extracted.headlineBadge,
          subtext: extracted.subtext,
          primaryMethodCode: 'cp-readoutput',
          primaryMethodName: spec.name,
          primaryMethodExplanation: spec.description,
          isDynamic: true,
          isApproximate: false,
          approximateCost: null,
          cpsRate: null,
          minPrice: extracted.minPrice,
          maxPrice: extracted.maxPrice,
          tiers: dp.map((tier: any) => ({
            inputs: tier.inputs || {},
            inputsDescription: this.formatInputsDescription(tier.inputs),
            price: Number(tier.price) || extracted.minPrice || 0,
            priceFormatted: extracted.priceFormatted,
            priceMethod: tier.priceMethod || 'cp-readoutput',
            priceMethodName: spec.name,
            note: tier.note,
          })),
          tokenPricingNote: readOutput.note || null,
        };
      }

      const prices = dp.map((d: any) => Number(d.price)).filter((p: number) => !isNaN(p));
      const min = prices.length ? Math.min(...prices) : 0;
      const max = prices.length ? Math.max(...prices) : 0;
      const primaryCode = dp[0].priceMethod || 'cpr';
      const spec = BILLING_METHODS_REFERENCE[primaryCode] || {
        name: primaryCode,
        category: 'Standard',
        description: 'Billed per model execution.',
      };

      const shortUnits: Record<string, string> = {
        cpr: 'req',
        cps: 'sec',
        cpo: 'output',
        cpt: 'tok',
        'cp-pixel': 'MPx',
        'cp-outputVideoLength': 'vid sec',
        'cp-audiosecondslength': 'aud sec',
        'cp-promptlength': 'char',
        cp: dp[0]?.note && /per second/i.test(dp[0].note) ? 'sec' : 'unit',
      };
      const unitLabel = shortUnits[primaryCode] || spec.name;

      const isTiered = dp.length > 1 && min !== max;
      const minFmt = this.formatCompactPriceNumber(min);
      const maxFmt = this.formatCompactPriceNumber(max);
      const headline = isTiered
        ? `$${minFmt}–$${maxFmt} / ${unitLabel}`
        : `$${minFmt} / ${unitLabel}`;

      // Summarize tier keys if tiered
      const tierKeys = Array.from(
        new Set(dp.flatMap((tier: any) => Object.keys(tier.inputs || {}))),
      );
      const subtext =
        dp.length > 1
          ? `${dp.length} tiers (${tierKeys.slice(0, 2).join(', ') || spec.name})`
          : `Fixed ${spec.name} rate`;

      return {
        billingType: isTiered ? 'tiered' : 'flat',
        headlineBadge: `💰 ${headline}`,
        subtext,
        primaryMethodCode: primaryCode,
        primaryMethodName: spec.name,
        primaryMethodExplanation: spec.description,
        isDynamic: true,
        isApproximate: false,
        approximateCost: null,
        cpsRate: null,
        minPrice: min,
        maxPrice: max,
        tiers: dp.map((tier: any) => {
          const tSpec = BILLING_METHODS_REFERENCE[tier.priceMethod] || {
            name: tier.priceMethod || 'Rate',
            category: 'Standard',
            description: '',
          };
          const pVal = Number(tier.price) || 0;
          return {
            inputs: tier.inputs || {},
            inputsDescription: this.formatInputsDescription(tier.inputs),
            price: pVal,
            priceFormatted: `$${this.formatCompactPriceNumber(pVal)} / ${tSpec.name}`,
            priceMethod: tier.priceMethod || 'cpr',
            priceMethodName: tSpec.name,
            priceExtra: tier.priceExtra,
            priceInput: tier.priceInput,
            note: tier.note,
          };
        }),
        tokenPricingNote: null,
      };
    }

    const approx = Number(t.approximatelycost) || 0;
    const cps = Number(t.cps) || Number(t.quegroupcps) || 0;

    if (approx > 0) {
      const spec = BILLING_METHODS_REFERENCE['cps'];
      const approxStr = this.formatCompactPriceNumber(approx);
      const cpsStr = cps > 0 ? `$${cps.toFixed(5).replace(/\.?0+$/, '')}/s` : '';
      return {
        billingType: 'approximate',
        headlineBadge: `⏱️ ~$${approxStr} / run${cpsStr ? ' (' + cpsStr + ')' : ''}`,
        subtext: cpsStr ? `Est. run • GPU rate ${cpsStr}` : 'Est. run (elapsed sec × cps)',
        primaryMethodCode: 'cps',
        primaryMethodName: 'Per Second (Est. Run)',
        primaryMethodExplanation: spec.description,
        isDynamic: false,
        isApproximate: true,
        approximateCost: approx,
        cpsRate: cps,
        minPrice: approx,
        maxPrice: approx,
        tiers: [],
        tokenPricingNote: null,
      };
    }

    if (cps > 0) {
      const spec = BILLING_METHODS_REFERENCE['cps'];
      const cpsStr = cps.toFixed(5).replace(/\.?0+$/, '');
      return {
        billingType: 'per-second',
        headlineBadge: `⏱️ $${cpsStr} / sec`,
        subtext: 'Billed per GPU second',
        primaryMethodCode: 'cps',
        primaryMethodName: 'Per Second',
        primaryMethodExplanation: spec.description,
        isDynamic: false,
        isApproximate: false,
        approximateCost: null,
        cpsRate: cps,
        minPrice: cps,
        maxPrice: cps,
        tiers: [],
        tokenPricingNote: null,
      };
    }

    return {
      billingType: 'unlisted',
      headlineBadge: 'Free / Unlisted',
      subtext: 'No rate specified',
      primaryMethodCode: 'none',
      primaryMethodName: 'Unlisted',
      primaryMethodExplanation: 'No price specified on marketplace.',
      isDynamic: false,
      isApproximate: false,
      approximateCost: null,
      cpsRate: null,
      minPrice: null,
      maxPrice: null,
      tiers: [],
      tokenPricingNote: null,
    };
  }

  private indexAndSaveCatalog(tools: any[], categoriesToSave?: string[]) {
    if (categoriesToSave && categoriesToSave.length > 0) {
      this.selectedCategories = categoriesToSave;
    }
    this.cachedRawTools.clear();
    const summaries: ModelSummary[] = [];

    for (const t of tools) {
      this.cachedRawTools.set(String(t.id), t);
      summaries.push({
        id: String(t.id),
        title: t.title || `${t.slugowner || 'unknown'}/${t.slugproject || 'model'}`,
        slug: `${t.slugowner || 'unknown'}/${t.slugproject || ''}`,
        slugowner: t.slugowner || 'unknown',
        slugproject: t.slugproject || '',
        description: t.description || '',
        image: t.image || null,
        categories: t.categories || [],
        type: this.classifyCategory(t.categories || []),
        computingtime: t.computingtime || null,
        hasParameters: Array.isArray(t.parameters) && t.parameters.length > 0,
        priority: t.priority ?? 0,
        pricing: this.parsePricingInfo(t),
      });
    }

    this.cachedSummaries = summaries;
    this.lastUpdated = new Date().toISOString();

    const dir = dirname(this.catalogPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(
      this.catalogPath,
      JSON.stringify(
        {
          lastUpdated: this.lastUpdated,
          selectedCategories: this.selectedCategories,
          models: this.cachedSummaries,
        },
        null,
        2,
      ),
      'utf-8',
    );

    this.logger.log(`Indexed and saved ${this.cachedSummaries.length} models into ${this.catalogPath}`);
  }

  classifyCategory(cats: string[]): ModelCategoryType {
    if (cats.some((c) => ['partner-llm', 'llm', 'llm-reasoning', 'chat'].includes(c))) return 'chat';
    if (cats.includes('text-to-image')) return 'text-to-image';
    if (cats.some((c) => ['image-to-image', 'image-editing'].includes(c))) return 'image-to-image';
    if (cats.some((c) => ['text-to-video', 'image-to-video', 'video-to-video'].includes(c))) return 'video';
    if (cats.some((c) => ['text-to-speech', 'speech-to-speech', 'voice-agent', 'voice-clone'].includes(c))) return 'voice';
    return 'other';
  }

  private getCombinedSummaries(): ModelSummary[] {
    const config = this.getLocalLlmConfig();
    if (!config.enabled) {
      return this.cachedSummaries;
    }
    // Trigger background refresh if local models haven't been checked in 15s
    if (Date.now() - this.localLastCheckedMs > 15000) {
      this.syncLocalModels().catch(() => {});
    }
    return [...this.localModels, ...this.cachedSummaries];
  }

  getCatalog(type?: string, query?: string): { models: ModelSummary[]; stats: ModelCatalogStats } {
    let result = this.getCombinedSummaries();

    if (type && type !== 'all') {
      result = result.filter((m) => m.type === type);
    }

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.slug.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.slugowner.toLowerCase().includes(q) ||
          m.pricing?.headlineBadge?.toLowerCase().includes(q),
      );
    }

    return {
      models: result,
      stats: this.getStats(),
    };
  }

  getStats(): ModelCatalogStats {
    const combined = this.getCombinedSummaries();
    const breakdown: Record<ModelCategoryType, number> = {
      chat: 0,
      'text-to-image': 0,
      'image-to-image': 0,
      video: 0,
      voice: 0,
      other: 0,
    };

    for (const m of combined) {
      breakdown[m.type] = (breakdown[m.type] || 0) + 1;
    }

    return {
      total: combined.length,
      lastUpdated: this.lastUpdated,
      selectedCategories: this.selectedCategories,
      breakdown,
      localModelsCount: this.localModels.length,
      localOnline: this.localOnline,
    };
  }

  getSelectedCategories(): string[] {
    return [...this.selectedCategories];
  }

  updateSelectedCategories(categories: string[]): { selectedCategories: string[] } {
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new Error('Categories must be a non-empty array of strings.');
    }
    const unique = Array.from(new Set(categories.map((c) => c.trim()).filter(Boolean)));
    this.selectedCategories = unique;

    if (existsSync(this.catalogPath)) {
      try {
        const content = JSON.parse(readFileSync(this.catalogPath, 'utf-8'));
        content.selectedCategories = this.selectedCategories;
        writeFileSync(this.catalogPath, JSON.stringify(content, null, 2), 'utf-8');
      } catch (err: any) {
        this.logger.warn(`Could not persist updated selectedCategories to ${this.catalogPath}: ${err.message}`);
      }
    }

    return { selectedCategories: this.selectedCategories };
  }

  getCategoryMetadata() {
    return {
      selectedCategories: this.selectedCategories,
      allKnownCategories: ALL_KNOWN_WIRO_CATEGORIES,
      groups: [
        {
          id: 'chat',
          name: '💬 Chat & LLMs',
          description: 'Companion dialogues, roleplay, multi-turn reasoning, and system prompting',
          categories: ['partner-llm', 'llm', 'llm-reasoning', 'chat'],
        },
        {
          id: 'text-to-image',
          name: '🎨 Avatar Generation (Text-to-Image)',
          description: 'Creating initial companion avatars and portraits from descriptive text',
          categories: ['text-to-image'],
        },
        {
          id: 'image-to-image',
          name: '🖼️ Scenes & Expressions (Image-to-Image)',
          description: 'Generating scene variations, poses, outfits, and emotional expressions from base portrait',
          categories: ['image-to-image', 'image-editing'],
        },
        {
          id: 'video',
          name: '🎬 Video & Portrait Animation',
          description: 'Animating companion avatars into motion video with prompt directions',
          categories: ['image-to-video', 'text-to-video'],
        },
      ],
    };
  }

  // --- Per-Model Detail File Cache Management ---

  public sanitizeSlug(val: string): string {
    return (val || 'unknown').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  }

  public getModelFilePath(slugowner: string, slugproject: string): { dir: string; filePath: string; relativePath: string } {
    const cleanOwner = this.sanitizeSlug(slugowner);
    const cleanProject = this.sanitizeSlug(slugproject);
    const dir = resolve(this.modelsDir, cleanOwner);
    const filePath = resolve(dir, `${cleanProject}.json`);
    const relativePath = `data/models/${cleanOwner}/${cleanProject}.json`;
    return { dir, filePath, relativePath };
  }

  public checkDetailCache(slugowner: string, slugproject: string): { isCached: boolean; cachedAt: string | null; relativePath: string } {
    const { filePath, relativePath } = this.getModelFilePath(slugowner, slugproject);
    if (existsSync(filePath)) {
      try {
        const stat = statSync(filePath);
        return { isCached: true, cachedAt: stat.mtime.toISOString(), relativePath };
      } catch {
        return { isCached: false, cachedAt: null, relativePath };
      }
    }
    return { isCached: false, cachedAt: null, relativePath };
  }

  public getCachedSlugs(): string[] {
    const cached: string[] = [];
    if (!existsSync(this.modelsDir)) return cached;

    try {
      const owners = readdirSync(this.modelsDir, { withFileTypes: true });
      for (const o of owners) {
        if (o.isDirectory()) {
          const ownerDir = resolve(this.modelsDir, o.name);
          const files = readdirSync(ownerDir);
          for (const f of files) {
            if (f.endsWith('.json')) {
              const project = f.replace(/\.json$/, '');
              cached.push(`${o.name}/${project}`);
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error scanning cached model slugs: ${err.message}`);
    }

    return cached;
  }

  async getOrFetchDetail(
    slugowner: string,
    slugproject: string,
    refresh = false,
    apiKey?: string,
  ): Promise<CachedModelDetailResponse> {
    // Handle local llama.cpp models without calling Wiro API
    if (slugowner.toLowerCase() === 'llamacpp') {
      if (refresh) {
        await this.syncLocalModels();
      }
      const localMatch =
        this.localModels.find(
          (m) =>
            m.slugproject.toLowerCase() === slugproject.toLowerCase() ||
            this.sanitizeSlug(m.slugproject) === this.sanitizeSlug(slugproject),
        ) || this.localModels[0];

      if (localMatch) {
        const rawLocal = this.localRawData.get(localMatch.slugproject) || {};
        return {
          success: true,
          fromCache: true,
          cachedAt: this.localLastChecked || new Date().toISOString(),
          filePath: this.getLocalLlmConfig().modelsUrl,
          detail: {
            id: localMatch.id,
            title: localMatch.title,
            slugowner: 'llamacpp',
            slugproject: localMatch.slugproject,
            description: localMatch.description,
            computingtime: localMatch.computingtime,
            categories: localMatch.categories,
            readme: `## Local llama.cpp Workstation Model\n\n- **Model ID**: \`${localMatch.slugproject}\`\n- **Endpoint**: \`${this.getLocalLlmConfig().modelsUrl}\`\n- **Chat Completions URL**: \`${this.getLocalLlmBaseUrl()}/v1/chat/completions\`\n- **Metadata**: \`${JSON.stringify(rawLocal.meta || {}, null, 2)}\``,
            parameters: [],
            rawLlamaCpp: rawLocal,
          },
          pricing: localMatch.pricing,
        };
      }
    }

    const { dir, filePath, relativePath } = this.getModelFilePath(slugowner, slugproject);

    // 1. If cache exists and refresh is NOT requested, read and serve from local disk
    if (!refresh && existsSync(filePath)) {
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        const tool = content.tool || content;
        const cachedAt = content.cachedAt || statSync(filePath).mtime.toISOString();
        return {
          success: true,
          fromCache: true,
          cachedAt,
          filePath: relativePath,
          detail: tool,
          pricing: this.parsePricingInfo(tool),
        };
      } catch (err: any) {
        this.logger.warn(`Failed reading cached file ${filePath}: ${err.message}. Re-fetching...`);
      }
    }

    // 2. Fetch live details from Wiro.ai /Tool/Detail
    this.logger.log(`Fetching model detail for ${slugowner}/${slugproject} from api.wiro.ai/v1/Tool/Detail...`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey.trim();
    }

    const response = await fetch('https://api.wiro.ai/v1/Tool/Detail', {
      method: 'POST',
      headers,
      body: JSON.stringify({ slugowner, slugproject }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Wiro.ai Tool/Detail error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    let tool = Array.isArray(data.tool) ? data.tool[0] : data.tool;

    if (!tool && data.result && data.data) {
      tool = data.data;
    }

    if (!tool) {
      throw new NotFoundException(`Model detail for '${slugowner}/${slugproject}' could not be found.`);
    }

    // 3. Cache to disk as JSON file
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const cachedAt = new Date().toISOString();
    const payload = {
      cachedAt,
      slugowner,
      slugproject,
      tool,
    };

    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    this.logger.log(`Cached model detail for ${slugowner}/${slugproject} to ${filePath}`);

    return {
      success: true,
      fromCache: false,
      cachedAt,
      filePath: relativePath,
      detail: tool,
      pricing: this.parsePricingInfo(tool),
    };
  }

  getModelDetails(id: string): any {
    const localFound = this.localModels.find((m) => m.id === id || m.slug === id);
    if (localFound) return localFound;

    if (this.cachedRawTools.has(id)) {
      return this.cachedRawTools.get(id);
    }

    if (existsSync(this.rawPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.rawPath, 'utf-8'));
        const found = (raw.tool || []).find((t: any) => String(t.id) === id);
        if (found) {
          this.cachedRawTools.set(id, found);
          return found;
        }
      } catch {}
    }

    const summary = this.cachedSummaries.find((m) => m.id === id);
    if (!summary) {
      throw new NotFoundException(`Model with ID '${id}' not found.`);
    }
    return summary;
  }

  async refreshCatalog(
    apiKey: string,
    categoriesToQuery?: string[],
  ): Promise<{ success: boolean; stats: ModelCatalogStats; message: string }> {
    const targetCategories =
      Array.isArray(categoriesToQuery) && categoriesToQuery.length > 0
        ? Array.from(new Set(categoriesToQuery.map((c) => c.trim()).filter(Boolean)))
        : this.selectedCategories;

    this.logger.log(
      `Refreshing live model catalog from Wiro.ai for ${targetCategories.length} categories: [${targetCategories.join(', ')}]...`,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
    };

    // Query Wiro individually per category to prevent 1,000 item limit from truncating smaller categories
    const responses = await Promise.all(
      targetCategories.map(async (cat) => {
        try {
          const res = await fetch('https://api.wiro.ai/v1/Tool/List', {
            method: 'POST',
            headers,
            body: JSON.stringify({ categories: [cat], limit: 1000 }),
          });
          if (!res.ok) {
            const errText = await res.text();
            this.logger.warn(`Failed fetching category '${cat}': status ${res.status} - ${errText}`);
            return [];
          }
          const json = await res.json();
          const list = Array.isArray(json.tool) ? json.tool : [];
          this.logger.log(`Category '${cat}' returned ${list.length} raw models.`);
          return list;
        } catch (err: any) {
          this.logger.warn(`Error querying category '${cat}': ${err.message}`);
          return [];
        }
      }),
    );

    const rawToolsMap = new Map<string, any>();
    for (const toolList of responses) {
      for (const tool of toolList) {
        const id = String(tool.id);
        if (!rawToolsMap.has(id)) {
          rawToolsMap.set(id, tool);
        }
      }
    }

    const uniqueTools = Array.from(rawToolsMap.values());
    if (uniqueTools.length === 0) {
      throw new Error('No tools returned from Wiro.ai for selected categories. Please check your API key.');
    }

    // Save full raw file
    const dir = dirname(this.rawPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.rawPath,
      JSON.stringify(
        {
          syncedAt: new Date().toISOString(),
          categories: targetCategories,
          count: uniqueTools.length,
          tool: uniqueTools,
        },
        null,
        2,
      ),
      'utf-8',
    );

    // Save selectedCategories and index catalog
    this.selectedCategories = targetCategories;
    this.indexAndSaveCatalog(uniqueTools, targetCategories);
    await this.syncLocalModels();

    const stats = this.getStats();
    return {
      success: true,
      stats,
      message: `Successfully synchronized ${stats.total} unique models across ${targetCategories.length} selected categories.`,
    };
  }

  // --- Default & Preferred Multimodal LLM Management ---

  public readonly DEFAULT_SYSTEM_MODELS: DefaultModelsConfig = {
    chatModel: 'openai/gpt-6.1-sol',
    textToImageModel: 'google/nano banana 2.1 advanced',
    imageToImageModel: 'wiro-partners/qwen image edit uncensored',
  };

  findModelByIdOrSlug(val?: string | null, expectedType?: ModelCategoryType): ModelSummary | null {
    if (!val || !val.trim()) return null;
    const target = val.trim().toLowerCase();
    const combined = this.getCombinedSummaries();

    // 1. Direct match on id
    let match = combined.find((m) => m.id.toLowerCase() === target);
    if (match) return match;

    // 2. Match on slug
    match = combined.find((m) => m.slug.toLowerCase() === target);
    if (match) return match;

    // 3. Match on slugproject
    match = combined.find((m) => m.slugproject.toLowerCase() === target);
    if (match) return match;

    // 4. Match on title
    match = combined.find((m) => m.title.toLowerCase() === target);
    if (match) return match;

    // 5. If expectedType given and nothing matched, find first model of that type
    if (expectedType) {
      const fallback = combined.find((m) => m.type === expectedType);
      if (fallback) return fallback;
    }

    return null;
  }

  getSystemDefaultModels(): DefaultModelsConfig {
    const current = this.dbService.getSetting<Partial<DefaultModelsConfig>>(
      'default_models',
      this.DEFAULT_SYSTEM_MODELS,
    );

    return {
      chatModel: current.chatModel?.trim() || this.DEFAULT_SYSTEM_MODELS.chatModel,
      textToImageModel: current.textToImageModel?.trim() || this.DEFAULT_SYSTEM_MODELS.textToImageModel,
      imageToImageModel: current.imageToImageModel?.trim() || this.DEFAULT_SYSTEM_MODELS.imageToImageModel,
    };
  }

  setSystemDefaultModels(update: Partial<DefaultModelsConfig>): ResolvedActiveModels {
    const current = this.getSystemDefaultModels();
    const next: DefaultModelsConfig = {
      chatModel: update.chatModel?.trim() || current.chatModel,
      textToImageModel: update.textToImageModel?.trim() || current.textToImageModel,
      imageToImageModel: update.imageToImageModel?.trim() || current.imageToImageModel,
    };

    this.dbService.setSetting('default_models', next);
    this.logger.log(`Updated tavern system default models: ${JSON.stringify(next)}`);
    return this.getActiveModels();
  }

  getActiveModels(userId?: string): ResolvedActiveModels {
    const system = this.getSystemDefaultModels();
    let userPreferred: UserPreferredModels = {};

    if (userId) {
      try {
        const db = this.dbService.getDb();
        const row = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId) as
          | { settings_json: string }
          | undefined;
        if (row && row.settings_json) {
          const parsed = JSON.parse(row.settings_json);
          if (parsed && typeof parsed.preferredModels === 'object' && parsed.preferredModels !== null) {
            userPreferred = parsed.preferredModels;
          }
        }
      } catch (e: any) {
        this.logger.warn(`Could not read user preferences for ${userId}: ${e.message}`);
      }
    }

    const effective: DefaultModelsConfig = {
      chatModel: userPreferred.chatModel?.trim() || system.chatModel,
      textToImageModel: userPreferred.textToImageModel?.trim() || system.textToImageModel,
      imageToImageModel: userPreferred.imageToImageModel?.trim() || system.imageToImageModel,
    };

    return {
      system,
      user: userPreferred,
      effective,
      resolved: {
        chat: this.findModelByIdOrSlug(effective.chatModel, 'chat'),
        textToImage: this.findModelByIdOrSlug(effective.textToImageModel, 'text-to-image'),
        imageToImage: this.findModelByIdOrSlug(effective.imageToImageModel, 'image-to-image'),
      },
    };
  }
}

