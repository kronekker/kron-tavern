import { Component, OnInit, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-modal.component.html',
  styleUrls: ['./auth-modal.component.scss'],
})
export class AuthModalComponent implements OnInit {
  authService = inject(AuthService);
  close = output<void>();
  openAdmin = output<void>();

  // State
  mode = signal<'login' | 'register'>('login');
  hasUsers = signal<boolean>(true);
  loading = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Form Fields
  email = '';
  username = '';
  loginHandle = '';
  password = '';
  apiKeyInput = '';

  ngOnInit() {
    this.checkStatus();
  }

  checkStatus() {
    this.authService.getStatus().subscribe({
      next: (status) => {
        this.hasUsers.set(status.hasUsers);
        // If no users exist, default to register mode for first-admin setup
        if (!status.hasUsers) {
          this.mode.set('register');
        }
      },
    });
  }

  submitAuth() {
    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (this.mode() === 'register') {
      if (!this.email || !this.username || !this.password) {
        this.errorMessage.set('All fields are required.');
        return;
      }
      this.loading.set(true);
      this.authService.register(this.email, this.username, this.password).subscribe({
        next: (res) => {
          this.loading.set(false);
          this.successMessage.set(
            res.user.isAdmin
              ? '👑 Administrator account initialized successfully!'
              : 'Account created and signed in!',
          );
          setTimeout(() => this.close.emit(), 1200);
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(err.error?.message || 'Registration failed.');
        },
      });
    } else {
      if (!this.loginHandle || !this.password) {
        this.errorMessage.set('Email/username and password are required.');
        return;
      }
      this.loading.set(true);
      this.authService.login(this.loginHandle, this.password).subscribe({
        next: () => {
          this.loading.set(false);
          this.close.emit();
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(err.error?.message || 'Invalid credentials.');
        },
      });
    }
  }

  saveApiKey() {
    if (!this.apiKeyInput.trim()) return;
    this.loading.set(true);
    this.authService.saveOpenRouterKey(this.apiKeyInput).subscribe({
      next: () => {
        this.loading.set(false);
        this.successMessage.set('OpenRouter API key encrypted and saved.');
        this.apiKeyInput = '';
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to save API key.');
      },
    });
  }

  removeApiKey() {
    this.loading.set(true);
    this.authService.deleteOpenRouterKey().subscribe({
      next: () => {
        this.loading.set(false);
        this.successMessage.set('OpenRouter API key removed.');
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to remove API key.');
      },
    });
  }
}
