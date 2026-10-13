import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface SessionItem {
  id: string;
  user_id: string;
  character_id: string;
  character_name?: string;
  character_avatar?: string | null;
  character_tagline?: string | null;
  active_persona_id: string | null;
  persona_name?: string;
  persona_avatar?: string | null;
  title: string;
  chat_model: string;
  text_to_image_model: string;
  image_to_image_model: string;
  active_compression_id?: string | null;
  context_threshold_percent: number;
  rolling_summary?: string | null;
  last_message?: string | null;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageItem {
  id: string;
  session_id: string;
  sender_type: 'user' | 'character' | 'system';
  sender_id?: string | null;
  sender_name?: string;
  sender_avatar?: string | null;
  content: string;
  is_canonical: number;
  ab_group_id?: string | null;
  reroll_parent_id?: string | null;
  model_used?: string | null;
  created_at: string;
  updated_at: string;
  trace?: TurnTraceItem | null;
}

export interface CompressionItem {
  id: string;
  session_id: string;
  boundary_message_id: string;
  summary_text: string;
  token_count_before: number;
  token_count_after: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TurnTraceItem {
  id: string;
  message_id: string;
  session_id: string;
  model_used: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  context_fill_percent: number;
  raw_request_json: string;
  raw_response_json: string;
  triggered_keywords_json: string;
  recalled_memories_json: string;
  compression_event_json?: string | null;
  created_at: string;
}

export interface SessionDetailsResponse {
  session: SessionItem;
  character: any;
  persona: any;
  messages: ChatMessageItem[];
  compression: CompressionItem | null;
}

export interface CreateSessionDto {
  characterId: string;
  personaId: string;
  title?: string;
  chatModel?: string;
  textToImageModel?: string;
  imageToImageModel?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SessionsService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  list(): Observable<SessionItem[]> {
    return this.http.get<SessionItem[]>('/api/sessions');
  }

  get(id: string): Observable<SessionDetailsResponse> {
    return this.http.get<SessionDetailsResponse>(`/api/sessions/${id}`);
  }

  create(dto: CreateSessionDto): Observable<{ session: SessionItem; initialMessage: ChatMessageItem }> {
    return this.http.post<{ session: SessionItem; initialMessage: ChatMessageItem }>('/api/sessions', dto);
  }

  delete(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`/api/sessions/${id}`);
  }

  updateModels(
    id: string,
    models: { chatModel?: string; textToImageModel?: string; imageToImageModel?: string },
  ): Observable<SessionItem> {
    return this.http.put<SessionItem>(`/api/sessions/${id}/models`, models);
  }

  editMessage(sessionId: string, messageId: string, content: string): Observable<ChatMessageItem> {
    return this.http.put<ChatMessageItem>(`/api/sessions/${sessionId}/messages/${messageId}`, { content });
  }

  rewind(sessionId: string, messageId: string): Observable<{ success: boolean; erasedCount: number }> {
    return this.http.post<{ success: boolean; erasedCount: number }>(`/api/sessions/${sessionId}/rewind`, { messageId });
  }

  suggestReply(sessionId: string): Observable<{ suggestedText: string }> {
    return this.http.post<{ suggestedText: string }>(`/api/sessions/${sessionId}/suggest-reply`, {});
  }

  compress(sessionId: string, boundaryMessageId: string, customSummary?: string): Observable<CompressionItem> {
    return this.http.post<CompressionItem>(`/api/sessions/${sessionId}/compress`, { boundaryMessageId, customSummary });
  }

  updateCompression(sessionId: string, compressionId: string, summaryText: string): Observable<CompressionItem> {
    return this.http.put<CompressionItem>(`/api/sessions/${sessionId}/compressions/${compressionId}`, { summaryText });
  }

  getTrace(sessionId: string, messageId: string): Observable<TurnTraceItem | null> {
    return this.http.get<TurnTraceItem | null>(`/api/sessions/${sessionId}/traces/${messageId}`);
  }

  // --- SSE Streaming Methods ---

  async sendMessageStream(
    sessionId: string,
    content: string,
    onToken: (token: string) => void,
  ): Promise<{ message: ChatMessageItem; trace: TurnTraceItem }> {
    const token = this.authService.token();
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message (${res.status}): ${await res.text()}`);
    }

    return this.consumeEventStream(res, onToken);
  }

  async rerollStream(
    sessionId: string,
    suggestion: string | undefined,
    onToken: (token: string) => void,
  ): Promise<{ message: ChatMessageItem; trace: TurnTraceItem }> {
    const token = this.authService.token();
    const res = await fetch(`/api/sessions/${sessionId}/reroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ suggestion }),
    });

    if (!res.ok) {
      throw new Error(`Failed to reroll turn (${res.status}): ${await res.text()}`);
    }

    return this.consumeEventStream(res, onToken);
  }

  private async consumeEventStream(
    res: Response,
    onToken: (token: string) => void,
  ): Promise<{ message: ChatMessageItem; trace: TurnTraceItem }> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: { message: ChatMessageItem; trace: TurnTraceItem } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'token') {
              onToken(data.token);
            } else if (data.type === 'complete') {
              finalResult = { message: data.message, trace: data.trace };
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (e: any) {
            if (e.message && e.message.startsWith('Turn execution failed')) {
              throw e;
            }
          }
        }
      }
    }

    if (!finalResult) {
      throw new Error('Stream ended without completion payload');
    }
    return finalResult;
  }
}
