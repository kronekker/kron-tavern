import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ModelCategoryFilter =
  | 'all'
  | 'chat'
  | 'text-to-image'
  | 'image-to-image'
  | 'video'
  | 'voice'
  | 'other';

export interface BillingMethodSpec {
  name: string;
  category: 'Fixed-Rate' | 'Usage-Based' | 'Special' | 'Standard';
  description: string;
}

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
  type: 'chat' | 'text-to-image' | 'image-to-image' | 'video' | 'voice' | 'other';
  types?: ('chat' | 'text-to-image' | 'image-to-image' | 'video' | 'voice' | 'other')[];
  computingtime: string | null;
  hasParameters: boolean;
  priority: number;
  pricing: ModelPricingInfo;
  isLocal?: boolean;
  localEndpoint?: string;
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

export interface CategoryGroup {
  id: string;
  name: string;
  description: string;
  categories: string[];
}

export interface CategoryMetadataResponse {
  selectedCategories: string[];
  allKnownCategories: string[];
  groups: CategoryGroup[];
}

export interface ModelCatalogStats {
  total: number;
  lastUpdated: string | null;
  selectedCategories?: string[];
  breakdown: Record<string, number>;
  localModelsCount?: number;
  localOnline?: boolean;
}

export interface ModelCatalogResponse {
  models: ModelSummary[];
  stats: ModelCatalogStats;
}

export interface CachedModelDetailResponse {
  success: boolean;
  fromCache: boolean;
  cachedAt: string;
  filePath: string;
  detail: any;
  pricing: ModelPricingInfo;
}

export interface RefreshCatalogResponse {
  success: boolean;
  stats: ModelCatalogStats;
  message: string;
}

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

@Injectable({
  providedIn: 'root',
})
export class ModelsService {
  private http = inject(HttpClient);

  getCatalog(type?: string, query?: string): Observable<ModelCatalogResponse> {
    let params = new HttpParams();
    if (type && type !== 'all') {
      params = params.set('type', type);
    }
    if (query && query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ModelCatalogResponse>('/api/models', { params });
  }

  getStats(): Observable<ModelCatalogStats> {
    return this.http.get<ModelCatalogStats>('/api/models/stats');
  }

  getLocalLlm(refresh = false): Observable<LocalLlmStatusResponse> {
    let params = new HttpParams();
    if (refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<LocalLlmStatusResponse>('/api/models/local', { params });
  }

  updateLocalLlm(config: Partial<LocalLlmConfig>): Observable<LocalLlmStatusResponse> {
    return this.http.put<LocalLlmStatusResponse>('/api/models/local', config);
  }

  getActiveDefaults(): Observable<ResolvedActiveModels> {
    return this.http.get<ResolvedActiveModels>('/api/models/defaults');
  }

  updateSystemDefaults(config: Partial<DefaultModelsConfig>): Observable<ResolvedActiveModels> {
    return this.http.put<ResolvedActiveModels>('/api/models/defaults/system', config);
  }

  updateUserDefaults(models: UserPreferredModels): Observable<ResolvedActiveModels> {
    return this.http.put<ResolvedActiveModels>('/api/models/defaults/user', models);
  }

  getCategories(): Observable<CategoryMetadataResponse> {
    return this.http.get<CategoryMetadataResponse>('/api/models/categories');
  }

  updateCategories(categories: string[]): Observable<{ selectedCategories: string[] }> {
    return this.http.put<{ selectedCategories: string[] }>('/api/models/categories', { categories });
  }

  getCachedSlugs(): Observable<{ cachedSlugs: string[] }> {
    return this.http.get<{ cachedSlugs: string[] }>('/api/models/cached-slugs');
  }

  getBillingReference(): Observable<{ methods: Record<string, BillingMethodSpec> }> {
    return this.http.get<{ methods: Record<string, BillingMethodSpec> }>('/api/models/billing-reference');
  }

  getModelDetail(slugowner: string, slugproject: string, refresh = false): Observable<CachedModelDetailResponse> {
    let params = new HttpParams()
      .set('slugowner', slugowner)
      .set('slugproject', slugproject);
    if (refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<CachedModelDetailResponse>('/api/models/detail', { params });
  }

  getModelDetails(id: string): Observable<any> {
    return this.http.get<any>(`/api/models/${id}`);
  }

  refreshCatalog(categories?: string[]): Observable<RefreshCatalogResponse> {
    return this.http.post<RefreshCatalogResponse>(
      '/api/models/refresh',
      categories && categories.length > 0 ? { categories } : {},
    );
  }
}

