import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { GeneratedImageItem } from './images.service';

export interface KeywordSnippet {
  id: string;
  character_id?: string | null;
  persona_id?: string | null;
  user_id: string;
  title: string;
  keywords: string;
  content: string;
  scope: string;
  priority: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CharacterItem {
  id: string;
  creator_id: string;
  creator_name?: string;
  name: string;
  avatar_url: string | null;
  avatar_prompt?: string | null;
  tagline: string | null;
  greeting: string;
  system_prompt: string;
  scenario: string | null;
  dialogue_examples: string | null;
  is_public: number;
  default_model: string | null;
  temperature: number;
  created_at: string;
  updated_at: string;
  snippet_count?: number;
  snippets?: KeywordSnippet[];
}

export interface CreateSnippetInput {
  id?: string;
  title: string;
  keywords: string;
  content: string;
  priority?: number;
  is_active?: boolean | number;
}

export interface CreateCharacterDto {
  name: string;
  avatar_url?: string | null;
  avatar_prompt?: string | null;
  tagline?: string | null;
  greeting: string;
  system_prompt: string;
  scenario?: string | null;
  dialogue_examples?: string | null;
  is_public?: boolean | number;
  default_model?: string | null;
  temperature?: number;
  snippets?: CreateSnippetInput[];
}

export interface UpdateCharacterDto {
  name?: string;
  avatar_url?: string | null;
  avatar_prompt?: string | null;
  tagline?: string | null;
  greeting?: string;
  system_prompt?: string;
  scenario?: string | null;
  dialogue_examples?: string | null;
  is_public?: boolean | number;
  default_model?: string | null;
  temperature?: number;
  snippets?: CreateSnippetInput[];
}

@Injectable({
  providedIn: 'root',
})
export class CharactersService {
  private http = inject(HttpClient);

  list(scope: 'all' | 'mine' | 'public' = 'all', query?: string): Observable<CharacterItem[]> {
    let params = new HttpParams().set('scope', scope);
    if (query && query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<CharacterItem[]>('/api/characters', { params });
  }

  get(id: string): Observable<CharacterItem> {
    return this.http.get<CharacterItem>(`/api/characters/${id}`);
  }

  create(dto: CreateCharacterDto): Observable<CharacterItem> {
    return this.http.post<CharacterItem>('/api/characters', dto);
  }

  update(id: string, dto: UpdateCharacterDto): Observable<CharacterItem> {
    return this.http.put<CharacterItem>(`/api/characters/${id}`, dto);
  }

  delete(id: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`/api/characters/${id}`);
  }

  generateAvatar(
    id: string,
    dto: { prompt: string; model?: string; aspectRatio?: string },
  ): Observable<{ character: CharacterItem; image: GeneratedImageItem }> {
    return this.http.post<{ character: CharacterItem; image: GeneratedImageItem }>(
      `/api/characters/${id}/generate-avatar`,
      dto,
    );
  }

  getSnippets(characterId: string): Observable<KeywordSnippet[]> {
    return this.http.get<KeywordSnippet[]>(`/api/characters/${characterId}/snippets`);
  }

  addSnippet(characterId: string, snippet: CreateSnippetInput): Observable<KeywordSnippet> {
    return this.http.post<KeywordSnippet>(`/api/characters/${characterId}/snippets`, snippet);
  }

  updateSnippet(characterId: string, snippetId: string, snippet: Partial<CreateSnippetInput>): Observable<KeywordSnippet> {
    return this.http.put<KeywordSnippet>(`/api/characters/${characterId}/snippets/${snippetId}`, snippet);
  }

  deleteSnippet(characterId: string, snippetId: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`/api/characters/${characterId}/snippets/${snippetId}`);
  }
}
