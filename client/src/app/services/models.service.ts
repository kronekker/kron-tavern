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
  computingtime: string | null;
  hasParameters: boolean;
  priority: number;
  pricing: ModelPricingInfo;
}

export interface ModelCatalogStats {
  total: number;
  lastUpdated: string | null;
  breakdown: Record<string, number>;
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

  refreshCatalog(): Observable<RefreshCatalogResponse> {
    return this.http.post<RefreshCatalogResponse>('/api/models/refresh', {});
  }
}
