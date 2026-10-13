import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { KeywordSnippet, CreateSnippetInput } from './characters.service';

export interface PersonaItem {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  description: string;
  speech_style: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
  snippet_count?: number;
  snippets?: KeywordSnippet[];
}

export interface CreatePersonaDto {
  name: string;
  avatar_url?: string | null;
  description: string;
  speech_style?: string | null;
  is_default?: boolean | number;
  snippets?: CreateSnippetInput[];
}

export interface UpdatePersonaDto {
  name?: string;
  avatar_url?: string | null;
  description?: string;
  speech_style?: string | null;
  is_default?: boolean | number;
  snippets?: CreateSnippetInput[];
}

@Injectable({
  providedIn: 'root',
})
export class PersonasService {
  private http = inject(HttpClient);

  list(): Observable<PersonaItem[]> {
    return this.http.get<PersonaItem[]>('/api/personas');
  }

  get(id: string): Observable<PersonaItem> {
    return this.http.get<PersonaItem>(`/api/personas/${id}`);
  }

  create(dto: CreatePersonaDto): Observable<PersonaItem> {
    return this.http.post<PersonaItem>('/api/personas', dto);
  }

  update(id: string, dto: UpdatePersonaDto): Observable<PersonaItem> {
    return this.http.put<PersonaItem>(`/api/personas/${id}`, dto);
  }

  delete(id: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`/api/personas/${id}`);
  }

  setDefault(id: string): Observable<PersonaItem> {
    return this.http.post<PersonaItem>(`/api/personas/${id}/default`, {});
  }

  getSnippets(personaId: string): Observable<KeywordSnippet[]> {
    return this.http.get<KeywordSnippet[]>(`/api/personas/${personaId}/snippets`);
  }

  addSnippet(personaId: string, snippet: CreateSnippetInput): Observable<KeywordSnippet> {
    return this.http.post<KeywordSnippet>(`/api/personas/${personaId}/snippets`, snippet);
  }

  updateSnippet(personaId: string, snippetId: string, snippet: Partial<CreateSnippetInput>): Observable<KeywordSnippet> {
    return this.http.put<KeywordSnippet>(`/api/personas/${personaId}/snippets/${snippetId}`, snippet);
  }

  deleteSnippet(personaId: string, snippetId: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`/api/personas/${personaId}/snippets/${snippetId}`);
  }
}
