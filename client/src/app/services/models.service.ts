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

  getModelDetails(id: string): Observable<any> {
    return this.http.get<any>(`/api/models/${id}`);
  }

  refreshCatalog(): Observable<RefreshCatalogResponse> {
    return this.http.post<RefreshCatalogResponse>('/api/models/refresh', {});
  }
}
