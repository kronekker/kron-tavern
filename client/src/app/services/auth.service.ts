import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  hasOpenRouterKey: boolean;
  settings: Record<string, any>;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private readonly TOKEN_KEY = 'kron_tavern_token';

  // Reactive state signals
  token = signal<string | null>(this.getStoredToken());
  currentUser = signal<UserResponse | null>(null);

  isAuthenticated = computed(() => !!this.currentUser());
  isAdmin = computed(() => !!this.currentUser()?.isAdmin);

  constructor() {
    if (this.token()) {
      this.fetchProfile().subscribe({
        error: () => this.logout(),
      });
    }
  }

  private getStoredToken(): string | null {
    try {
      return localStorage.getItem(this.TOKEN_KEY);
    } catch {
      return null;
    }
  }

  getStatus(): Observable<{ hasUsers: boolean; totalUsers: number }> {
    return this.http.get<{ hasUsers: boolean; totalUsers: number }>('/api/auth/status');
  }

  register(email: string, username: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/register', { email, username, password }).pipe(
      tap((res) => {
        this.setSession(res.token, res.user);
      }),
    );
  }

  login(login: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/login', { login, password }).pipe(
      tap((res) => {
        this.setSession(res.token, res.user);
      }),
    );
  }

  fetchProfile(): Observable<UserResponse> {
    return this.http.get<UserResponse>('/api/auth/me').pipe(
      tap((user) => {
        this.currentUser.set(user);
      }),
    );
  }

  saveOpenRouterKey(apiKey: string): Observable<{ success: boolean; message: string }> {
    return this.http.put<{ success: boolean; message: string }>('/api/auth/openrouter-key', { apiKey }).pipe(
      tap(() => {
        const u = this.currentUser();
        if (u) {
          this.currentUser.set({ ...u, hasOpenRouterKey: true });
        }
      }),
    );
  }

  deleteOpenRouterKey(): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>('/api/auth/openrouter-key').pipe(
      tap(() => {
        const u = this.currentUser();
        if (u) {
          this.currentUser.set({ ...u, hasOpenRouterKey: false });
        }
      }),
    );
  }

  logout() {
    this.token.set(null);
    this.currentUser.set(null);
    try {
      localStorage.removeItem(this.TOKEN_KEY);
    } catch {}
  }

  private setSession(token: string, user: UserResponse) {
    this.token.set(token);
    this.currentUser.set(user);
    try {
      localStorage.setItem(this.TOKEN_KEY, token);
    } catch {}
  }
}
