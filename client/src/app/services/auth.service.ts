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
  private readonly USER_KEY = 'kron_tavern_user';

  // Synchronously hydrated state from localStorage (zero flash / instant restore)
  token = signal<string | null>(this.getStoredToken());
  currentUser = signal<UserResponse | null>(this.getStoredUser());

  isAuthenticated = computed(() => !!this.currentUser());
  isAdmin = computed(() => !!this.currentUser()?.isAdmin);

  constructor() {
    // If a token exists, silently verify and synchronize latest profile from server
    if (this.token()) {
      this.fetchProfile().subscribe({
        error: (err) => {
          // Only invalidate local session if token is actively rejected (401 / 403)
          if (err.status === 401 || err.status === 403) {
            console.warn('Session expired or invalid, logging out.');
            this.logout();
          }
        },
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

  private getStoredUser(): UserResponse | null {
    try {
      const raw = localStorage.getItem(this.USER_KEY);
      return raw ? (JSON.parse(raw) as UserResponse) : null;
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
        try {
          localStorage.setItem(this.USER_KEY, JSON.stringify(user));
        } catch {}
      }),
    );
  }

  saveOpenRouterKey(apiKey: string): Observable<{ success: boolean; message: string }> {
    return this.http.put<{ success: boolean; message: string }>('/api/auth/openrouter-key', { apiKey }).pipe(
      tap(() => {
        const u = this.currentUser();
        if (u) {
          const updated = { ...u, hasOpenRouterKey: true };
          this.currentUser.set(updated);
          try {
            localStorage.setItem(this.USER_KEY, JSON.stringify(updated));
          } catch {}
        }
      }),
    );
  }

  deleteOpenRouterKey(): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>('/api/auth/openrouter-key').pipe(
      tap(() => {
        const u = this.currentUser();
        if (u) {
          const updated = { ...u, hasOpenRouterKey: false };
          this.currentUser.set(updated);
          try {
            localStorage.setItem(this.USER_KEY, JSON.stringify(updated));
          } catch {}
        }
      }),
    );
  }

  logout() {
    this.token.set(null);
    this.currentUser.set(null);
    try {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
    } catch {}
  }

  private setSession(token: string, user: UserResponse) {
    this.token.set(token);
    this.currentUser.set(user);
    try {
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    } catch {}
  }
}
