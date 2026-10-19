import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface GeneratedImageItem {
  id: string;
  user_id: string;
  character_id?: string | null;
  character_name?: string | null;
  mode: 'text-to-image' | 'image-to-image' | 'avatar';
  prompt: string;
  model_used: string;
  file_path: string;
  image_url: string;
  reference_image_url?: string | null;
  aspect_ratio?: string | null;
  width?: number | null;
  height?: number | null;
  file_size_bytes?: number | null;
  latency_ms?: number | null;
  raw_response_json?: string | null;
  created_at: string;
  file_exists?: boolean;
}

export interface GenerateTextToImageDto {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  characterId?: string;
  mode?: 'text-to-image' | 'avatar';
  extraParams?: Record<string, any>;
}

export interface GenerateImageToImageDto {
  prompt: string;
  referenceImageBase64?: string;
  referenceImageUrl?: string;
  model?: string;
  aspectRatio?: string;
  characterId?: string;
  extraParams?: Record<string, any>;
}

@Injectable({
  providedIn: 'root',
})
export class ImagesService {
  private http = inject(HttpClient);

  listImages(filters?: { mode?: string; characterId?: string }): Observable<GeneratedImageItem[]> {
    let params = new HttpParams();
    if (filters?.mode) {
      params = params.set('mode', filters.mode);
    }
    if (filters?.characterId) {
      params = params.set('characterId', filters.characterId);
    }
    return this.http.get<GeneratedImageItem[]>('/api/images', { params });
  }

  generateTextToImage(dto: GenerateTextToImageDto): Observable<GeneratedImageItem> {
    return this.http.post<GeneratedImageItem>('/api/images/text-to-image', dto);
  }

  generateImageToImage(dto: GenerateImageToImageDto): Observable<GeneratedImageItem> {
    return this.http.post<GeneratedImageItem>('/api/images/image-to-image', dto);
  }

  deleteImage(id: string): Observable<{ deleted: boolean; id: string }> {
    return this.http.delete<{ deleted: boolean; id: string }>(`/api/images/${id}`);
  }
}
