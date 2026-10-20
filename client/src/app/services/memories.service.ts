import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface EpisodicMemoryItem {
  id: string;
  character_id?: string | null;
  character_name?: string | null;
  session_id?: string | null;
  session_title?: string | null;
  user_id: string;
  memory_text: string;
  scope: 'session' | 'user';
  importance: number;
  source_turn_id?: string | null;
  created_at: string;
  similarity?: number | null;
  memory_type?: string;
}

export interface CreateEpisodicMemoryDto {
  sessionId?: string | null;
  characterId?: string | null;
  memoryText: string;
  scope?: 'session' | 'user';
  importance?: number;
}

export interface UpdateEpisodicMemoryDto {
  memoryText?: string;
  scope?: 'session' | 'user';
  importance?: number;
}

@Injectable({
  providedIn: 'root',
})
export class MemoriesService {
  private http = inject(HttpClient);

  list(filters?: {
    sessionId?: string;
    characterId?: string;
    scope?: 'session' | 'user' | 'all';
  }): Observable<EpisodicMemoryItem[]> {
    let params = new HttpParams();
    if (filters?.sessionId) params = params.set('sessionId', filters.sessionId);
    if (filters?.characterId) params = params.set('characterId', filters.characterId);
    if (filters?.scope) params = params.set('scope', filters.scope);
    return this.http.get<EpisodicMemoryItem[]>('/api/memories', { params });
  }

  search(sessionId: string, queryText: string): Observable<EpisodicMemoryItem[]> {
    const params = new HttpParams().set('sessionId', sessionId).set('q', queryText);
    return this.http.get<EpisodicMemoryItem[]>('/api/memories/search', { params });
  }

  create(dto: CreateEpisodicMemoryDto): Observable<EpisodicMemoryItem> {
    return this.http.post<EpisodicMemoryItem>('/api/memories', dto);
  }

  extractFromSession(
    sessionId: string,
    turnCount = 8,
  ): Observable<{ extractedCount: number; memories: EpisodicMemoryItem[] }> {
    return this.http.post<{ extractedCount: number; memories: EpisodicMemoryItem[] }>(
      `/api/memories/extract/${sessionId}`,
      { turnCount },
    );
  }

  update(id: string, dto: UpdateEpisodicMemoryDto): Observable<EpisodicMemoryItem> {
    return this.http.put<EpisodicMemoryItem>(`/api/memories/${id}`, dto);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`/api/memories/${id}`);
  }
}
