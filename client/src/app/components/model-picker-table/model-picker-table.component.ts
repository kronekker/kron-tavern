import { Component, OnInit, inject, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModelsService,
  ModelSummary,
  ModelPricingInfo,
  LocalLlmStatusResponse,
} from '../../services/models.service';
import { AuthService } from '../../services/auth.service';

export type PickerModelRole = 'chat' | 'text-to-image' | 'image-to-image';

@Component({
  selector: 'app-model-picker-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-picker-table.component.html',
  styleUrls: ['./model-picker-table.component.scss'],
})
export class ModelPickerTableComponent implements OnInit {
  private modelsService = inject(ModelsService);
  authService = inject(AuthService);

  // Selected model slugs/ids for the 3 AI types
  chatModel = input<string>('');
  textToImageModel = input<string>('');
  imageToImageModel = input<string>('');

  // Optional: allow empty selection to inherit system defaults (used in User Profile)
  allowInheritDefault = input<boolean>(false);
  systemChatTitle = input<string>('Tavern Default');
  systemT2ITitle = input<string>('Tavern Default');
  systemI2ITitle = input<string>('Tavern Default');

  // Outputs when user selects a model
  chatModelChange = output<string>();
  textToImageModelChange = output<string>();
  imageToImageModelChange = output<string>();

  // Models lists (can be passed in or loaded automatically)
  chatModels = input<ModelSummary[]>([]);
  textToImageModels = input<ModelSummary[]>([]);
  imageToImageModels = input<ModelSummary[]>([]);

  // UI state
  initialRole = input<PickerModelRole>('chat');
  activeRole = signal<PickerModelRole>('chat');
  searchQuery = signal<string>('');

  // Local llama.cpp status & config editor
  localStatus = signal<LocalLlmStatusResponse | null>(null);
  showLocalConfig = signal<boolean>(false);
  localUrlInput = signal<string>('http://localhost:8080/models');
  localEnabledInput = signal<boolean>(true);
  syncingLocal = signal<boolean>(false);

  // Internal fallback lists if parent didn't pass models
  internalChatModels = signal<ModelSummary[]>([]);
  internalT2IModels = signal<ModelSummary[]>([]);
  internalI2IModels = signal<ModelSummary[]>([]);

  effectiveChatModels = computed(() => {
    const internal = this.internalChatModels();
    if (internal.length > 0) return internal;
    return this.chatModels() || [];
  });

  effectiveT2IModels = computed(() => {
    const internal = this.internalT2IModels();
    if (internal.length > 0) return internal;
    return this.textToImageModels() || [];
  });

  effectiveI2IModels = computed(() => {
    const internal = this.internalI2IModels();
    if (internal.length > 0) return internal;
    return this.imageToImageModels() || [];
  });

  currentRoleModels = computed(() => {
    const role = this.activeRole();
    let list: ModelSummary[] = [];
    if (role === 'chat') list = this.effectiveChatModels();
    else if (role === 'text-to-image') list = this.effectiveT2IModels();
    else list = this.effectiveI2IModels();

    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;

    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        m.slugowner.toLowerCase().includes(q) ||
        m.pricing?.headlineBadge?.toLowerCase().includes(q) ||
        m.pricing?.subtext?.toLowerCase().includes(q) ||
        m.pricing?.primaryMethodName?.toLowerCase().includes(q),
    );
  });

  selectedChatSummary = computed(() => {
    const val = this.chatModel();
    if (!val) return null;
    return this.findSummary(this.effectiveChatModels(), val);
  });

  selectedT2ISummary = computed(() => {
    const val = this.textToImageModel();
    if (!val) return null;
    return this.findSummary(this.effectiveT2IModels(), val);
  });

  selectedI2ISummary = computed(() => {
    const val = this.imageToImageModel();
    if (!val) return null;
    return this.findSummary(this.effectiveI2IModels(), val);
  });

  ngOnInit() {
    this.activeRole.set(this.initialRole());
    this.loadLocalStatus();
    if (this.chatModels().length === 0) {
      this.loadAllModels();
    }
  }

  loadAllModels() {
    this.modelsService.getCatalog('all').subscribe({
      next: (res) => {
        const all = res.models || [];
        this.internalChatModels.set(all.filter((m) => m.type === 'chat'));
        this.internalT2IModels.set(all.filter((m) => m.type === 'text-to-image'));
        this.internalI2IModels.set(all.filter((m) => m.type === 'image-to-image'));
      },
    });
  }

  loadLocalStatus(refresh = false) {
    this.syncingLocal.set(true);
    this.modelsService.getLocalLlm(refresh).subscribe({
      next: (status) => {
        this.localStatus.set(status);
        this.localUrlInput.set(status.config.modelsUrl);
        this.localEnabledInput.set(status.config.enabled);
        this.syncingLocal.set(false);
        if (refresh) {
          this.loadAllModels();
        }
      },
      error: () => {
        this.syncingLocal.set(false);
      },
    });
  }

  saveLocalConfig() {
    this.syncingLocal.set(true);
    this.modelsService
      .updateLocalLlm({
        enabled: this.localEnabledInput(),
        modelsUrl: this.localUrlInput().trim() || 'http://localhost:8080/models',
      })
      .subscribe({
        next: (status) => {
          this.localStatus.set(status);
          this.syncingLocal.set(false);
          this.showLocalConfig.set(false);
          this.loadAllModels();
          if (status.models.length > 0 && status.config.enabled) {
            this.selectModel(status.models[0].slug);
          }
        },
        error: () => {
          this.syncingLocal.set(false);
        },
      });
  }

  selectLocalModel(m: ModelSummary) {
    this.activeRole.set('chat');
    this.chatModelChange.emit(m.slug);
  }

  private findSummary(list: ModelSummary[], val: string): ModelSummary | null {
    const clean = val.trim().toLowerCase();
    return (
      list.find(
        (m) =>
          m.slug.toLowerCase() === clean ||
          m.id.toLowerCase() === clean ||
          m.slugproject.toLowerCase() === clean ||
          m.title.toLowerCase() === clean,
      ) || null
    );
  }

  setRole(role: PickerModelRole) {
    this.activeRole.set(role);
    this.searchQuery.set('');
  }

  getActiveSelectionValue(): string {
    const role = this.activeRole();
    if (role === 'chat') return this.chatModel();
    if (role === 'text-to-image') return this.textToImageModel();
    return this.imageToImageModel();
  }

  isModelSelected(m: ModelSummary): boolean {
    const cur = (this.getActiveSelectionValue() || '').trim().toLowerCase();
    if (!cur) return false;
    return (
      m.slug.toLowerCase() === cur ||
      m.id.toLowerCase() === cur ||
      m.slugproject.toLowerCase() === cur
    );
  }

  selectModel(slug: string) {
    const role = this.activeRole();
    if (role === 'chat') this.chatModelChange.emit(slug);
    else if (role === 'text-to-image') this.textToImageModelChange.emit(slug);
    else this.imageToImageModelChange.emit(slug);
  }

  getPricingClass(pricing?: ModelPricingInfo): string {
    if (!pricing) return 'cost-neutral';
    if (pricing.primaryMethodCode === 'local') return 'cost-local';
    switch (pricing.billingType) {
      case 'token-based':
        return 'cost-token';
      case 'flat':
        return 'cost-flat';
      case 'tiered':
        return 'cost-tiered';
      case 'approximate':
      case 'per-second':
        return 'cost-sec';
      default:
        return 'cost-neutral';
    }
  }
}
