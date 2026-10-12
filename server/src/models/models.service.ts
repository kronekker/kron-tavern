import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type ModelCategoryType = 'chat' | 'text-to-image' | 'image-to-image' | 'video' | 'voice' | 'other';

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
}

export interface ModelCatalogStats {
  total: number;
  lastUpdated: string | null;
  breakdown: Record<ModelCategoryType, number>;
}

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);
  private readonly catalogPath: string;
  private readonly rawPath: string;

  private cachedSummaries: ModelSummary[] = [];
  private cachedRawTools: Map<string, any> = new Map();
  private lastUpdated: string | null = null;

  constructor() {
    const isInsideServer = existsSync(resolve(process.cwd(), 'nest-cli.json'));
    const rootDir = isInsideServer ? resolve(process.cwd(), '..') : process.cwd();
    const dataDir = resolve(rootDir, 'data');
    this.catalogPath = resolve(dataDir, 'wiro-models-catalog.json');
    this.rawPath = resolve(dataDir, 'wiro-models.json');
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
        this.logger.log(`Loaded ${this.cachedSummaries.length} model summaries from ${this.catalogPath}`);
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

  private indexAndSaveCatalog(tools: any[]) {
    this.cachedRawTools.clear();
    const summaries: ModelSummary[] = [];

    for (const t of tools) {
      this.cachedRawTools.set(t.id, t);
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
      });
    }

    this.cachedSummaries = summaries;
    this.lastUpdated = new Date().toISOString();

    // Persist optimized catalog to disk for fast boot
    const dir = dirname(this.catalogPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(
      this.catalogPath,
      JSON.stringify({ lastUpdated: this.lastUpdated, models: this.cachedSummaries }, null, 2),
      'utf-8',
    );

    this.logger.log(`Indexed and saved ${this.cachedSummaries.length} models into ${this.catalogPath}`);
  }

  classifyCategory(cats: string[]): ModelCategoryType {
    if (cats.includes('partner-llm') || cats.includes('llm') || cats.includes('llm-reasoning')) return 'chat';
    if (cats.includes('text-to-image')) return 'text-to-image';
    if (cats.includes('image-to-image') || cats.includes('image-editing')) return 'image-to-image';
    if (cats.includes('text-to-video') || cats.includes('image-to-video') || cats.includes('video-to-video')) return 'video';
    if (cats.includes('text-to-speech') || cats.includes('speech-to-speech') || cats.includes('voice-agent')) return 'voice';
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
      breakdown,
    };
  }

  getModelDetails(id: string): any {
    // Check in-memory raw tools cache
    if (this.cachedRawTools.has(id)) {
      return this.cachedRawTools.get(id);
    }

    // Try reading from raw JSON file on disk
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

  async refreshCatalog(apiKey: string): Promise<{ success: boolean; stats: ModelCatalogStats; message: string }> {
    this.logger.log('Fetching live model catalog from Wiro.ai (Tool/List)...');

    const response = await fetch('https://api.wiro.ai/v1/Tool/List', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
      },
      body: JSON.stringify({ limit: 1000, page: 1 }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Wiro.ai API returned error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const tools = data.tool || [];

    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error('No tools returned from Wiro.ai. Please check your API key.');
    }

    // Save full raw file
    const dir = dirname(this.rawPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.rawPath, JSON.stringify(data, null, 2), 'utf-8');

    // Index into lightweight catalog
    this.indexAndSaveCatalog(tools);

    const stats = this.getStats();
    return {
      success: true,
      stats,
      message: `Successfully synchronized ${stats.total} models from Wiro.ai.`,
    };
  }
}
