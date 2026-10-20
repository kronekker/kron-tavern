import { Component, OnInit, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import {
  ModelsService,
  ModelSummary,
  ResolvedActiveModels,
} from '../../services/models.service';
import { ModelPickerTableComponent } from '../model-picker-table/model-picker-table.component';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModelPickerTableComponent],
  templateUrl: './auth-modal.component.html',
  styleUrls: ['./auth-modal.component.scss'],
})
export class AuthModalComponent implements OnInit {
  authService = inject(AuthService);
  private modelsService = inject(ModelsService);
  close = output<void>();
  openAdmin = output<void>();

  // State
  mode = signal<'login' | 'register'>('login');
  hasUsers = signal<boolean>(true);
  loading = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Preferred Models State
  activeDefaults = signal<ResolvedActiveModels | null>(null);
  chatModels = signal<ModelSummary[]>([]);
  textToImageModels = signal<ModelSummary[]>([]);
  imageToImageModels = signal<ModelSummary[]>([]);
  userChatModel = signal<string>('');
  userT2IModel = signal<string>('');
  userI2IModel = signal<string>('');
  savingPreferences = signal<boolean>(false);

  // Form Fields
  email = '';
  username = '';
  loginHandle = '';
  password = '';
  apiKeyInput = '';

  ngOnInit() {
    this.checkStatus();
    if (this.authService.isAuthenticated()) {
      this.loadDefaultsAndModels();
    }
  }

  loadDefaultsAndModels() {
    this.modelsService.getActiveDefaults().subscribe({
      next: (res) => {
        this.activeDefaults.set(res);
        this.userChatModel.set(res.user?.chatModel || '');
        this.userT2IModel.set(res.user?.textToImageModel || '');
        this.userI2IModel.set(res.user?.imageToImageModel || '');
      },
      error: (err) => console.error('Failed to load active defaults for user', err),
    });

    this.modelsService.getCatalog('all').subscribe({
      next: (res) => {
        this.chatModels.set(res.models.filter((m) => m.type === 'chat' || m.types?.includes('chat')));
        this.textToImageModels.set(res.models.filter((m) => m.type === 'text-to-image' || m.types?.includes('text-to-image')));
        this.imageToImageModels.set(res.models.filter((m) => m.type === 'image-to-image' || m.types?.includes('image-to-image')));
      },
      error: (err) => console.error('Failed to load catalog models', err),
    });
  }

  savePreferredModels() {
    this.savingPreferences.set(true);
    this.modelsService
      .updateUserDefaults({
        chatModel: this.userChatModel() || null,
        textToImageModel: this.userT2IModel() || null,
        imageToImageModel: this.userI2IModel() || null,
      })
      .subscribe({
        next: (res) => {
          this.savingPreferences.set(false);
          this.activeDefaults.set(res);
          this.successMessage.set('Preferred AI models saved to your personal profile!');
          setTimeout(() => this.successMessage.set(null), 3500);
        },
        error: (err) => {
          this.savingPreferences.set(false);
          this.errorMessage.set(err.error?.message || 'Failed to save preferred models.');
        },
      });
  }

  resetPreferredModels() {
    this.savingPreferences.set(true);
    this.modelsService
      .updateUserDefaults({
        chatModel: null,
        textToImageModel: null,
        imageToImageModel: null,
      })
      .subscribe({
        next: (res) => {
          this.savingPreferences.set(false);
          this.activeDefaults.set(res);
          this.userChatModel.set('');
          this.userT2IModel.set('');
          this.userI2IModel.set('');
          this.successMessage.set('All models reset to tavern administrator defaults.');
          setTimeout(() => this.successMessage.set(null), 3500);
        },
        error: (err) => {
          this.savingPreferences.set(false);
          this.errorMessage.set(err.error?.message || 'Failed to reset models.');
        },
      });
  }

  getSystemChatTitle(): string {
    return this.activeDefaults()?.resolved.chat?.title || this.activeDefaults()?.system.chatModel || 'Admin Default';
  }

  getSystemT2ITitle(): string {
    return this.activeDefaults()?.resolved.textToImage?.title || this.activeDefaults()?.system.textToImageModel || 'Admin Default';
  }

  getSystemI2ITitle(): string {
    return this.activeDefaults()?.resolved.imageToImage?.title || this.activeDefaults()?.system.imageToImageModel || 'Admin Default';
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
    const cleanKey = this.apiKeyInput.trim();
    if (!cleanKey) return;
    this.loading.set(true);
    this.authService.saveWiroKey(cleanKey).subscribe({
      next: () => {
        this.loading.set(false);
        this.successMessage.set('Wiro.ai API key encrypted and saved.');
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
    this.authService.deleteWiroKey().subscribe({
      next: () => {
        this.loading.set(false);
        this.successMessage.set('Wiro.ai API key removed.');
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to remove API key.');
      },
    });
  }
}
