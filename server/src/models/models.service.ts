import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

export type ModelCategoryType = 'chat' | 'text-to-image' | 'image-to-image' | 'video' | 'voice' | 'other';

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

  constructor() {
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

  onModuleInit() {
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      // 1. If catalog cache exists, read it
      if (existsSync(this.catalogPath)) {
        const content = JSON.parse(readFileSync(this.catalogPath, 'utf-8'));
        this.cachedSummaries = content.models || [];
        this.lastUpdated = content.lastUpdated || null;
        this.selectedCategories =
          Array.isArray(content.selectedCategories) && content.selectedCategories.length > 0
            ? content.selectedCategories
            : [...DEFAULT_SELECTED_CATEGORIES];
        this.logger.log(
          `Loaded ${this.cachedSummaries.length} model summaries across ${this.selectedCategories.length} categories from ${this.catalogPath}`,
        );
        return;
      }

      // 2. If raw file exists, index it into catalog
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

  private formatInputsDescription(inputs: Record<string, any>): string {
    if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
      return 'Default / All Configurations';
    }
    return Object.entries(inputs)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' • ');
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
        return {
          billingType: 'token-based',
          headlineBadge: '💬 Token-Based',
          subtext: 'Model-Reported Token Usage',
          primaryMethodCode: 'cp-readoutput',
          primaryMethodName: spec.name,
          primaryMethodExplanation: spec.description,
          isDynamic: true,
          isApproximate: false,
          approximateCost: null,
          cpsRate: null,
          minPrice: 0,
          maxPrice: 0,
          tiers: dp.map((tier: any) => ({
            inputs: tier.inputs || {},
            inputsDescription: this.formatInputsDescription(tier.inputs),
            price: Number(tier.price) || 0,
            priceFormatted: '$0 (Reported per token)',
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

      const isTiered = dp.length > 1 && min !== max;
      const headline = isTiered
        ? `$${min} – $${max} / ${spec.name}`
        : `$${min} / ${spec.name}`;

      return {
        billingType: isTiered ? 'tiered' : 'flat',
        headlineBadge: `💰 ${headline}`,
        subtext: isTiered ? `${dp.length} parameter tiers` : `Fixed ${spec.name} rate`,
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
            priceFormatted: `$${pVal} / ${tSpec.name}`,
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

    const approx = Number(t.approximatelycost);
    if (approx && approx > 0) {
      const cps = Number(t.cps || t.quegroupcps || 0);
      const spec = BILLING_METHODS_REFERENCE['cps'];
      return {
        billingType: 'approximate',
        headlineBadge: `⏱️ ~$${approx.toFixed(3)} (est. run)`,
        subtext: 'Fallback: elapsed seconds × cps rate',
        primaryMethodCode: 'cps',
        primaryMethodName: 'Per Second (Fallback)',
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

    const cps = Number(t.cps || t.quegroupcps);
    if (cps && cps > 0) {
      const spec = BILLING_METHODS_REFERENCE['cps'];
      return {
        billingType: 'per-second',
        headlineBadge: `⏱️ $${cps.toFixed(5)} / sec`,
        subtext: 'Billed per processing second',
        primaryMethodCode: 'cps',
        primaryMethodName: 'Per Second',
        primaryMethodExplanation: spec.description,
        isDynamic: false,
        isApproximate: false,
        approximateCost: null,
        cpsRate: cps,
        minPrice: null,
        maxPrice: null,
        tiers: [],
        tokenPricingNote: null,
      };
    }

    return {
      billingType: 'unlisted',
      headlineBadge: 'Free / Unlisted',
      subtext: 'No dynamic rate specified',
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
        title: t.title || 'Untitled Model',
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

  getCatalog(type?: string, query?: string): { models: ModelSummary[]; stats: ModelCatalogStats } {
    let result = this.cachedSummaries;

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
          m.slugowner.toLowerCase().includes(q),
      );
    }

    return {
      models: result,
      stats: this.getStats(),
    };
  }

  getStats(): ModelCatalogStats {
    const breakdown: Record<ModelCategoryType, number> = {
      chat: 0,
      'text-to-image': 0,
      'image-to-image': 0,
      video: 0,
      voice: 0,
      other: 0,
    };

    for (const m of this.cachedSummaries) {
      breakdown[m.type] = (breakdown[m.type] || 0) + 1;
    }

    return {
      total: this.cachedSummaries.length,
      lastUpdated: this.lastUpdated,
      selectedCategories: this.selectedCategories,
      breakdown,
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

    const stats = this.getStats();
    return {
      success: true,
      stats,
      message: `Successfully synchronized ${stats.total} unique models across ${targetCategories.length} selected categories.`,
    };
  }
}
