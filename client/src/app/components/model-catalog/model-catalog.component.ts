import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModelsService,
  ModelSummary,
  ModelCatalogStats,
  ModelCategoryFilter,
  CachedModelDetailResponse,
  BillingMethodSpec,
  ModelPricingInfo,
  CategoryMetadataResponse,
  CategoryGroup,
  ResolvedActiveModels,
} from '../../services/models.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-model-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-catalog.component.html',
  styleUrls: ['./model-catalog.component.scss'],
})
export class ModelCatalogComponent implements OnInit {
  modelsService = inject(ModelsService);
  authService = inject(AuthService);

  close = output<void>();

  // State
  models = signal<ModelSummary[]>([]);
  stats = signal<ModelCatalogStats | null>(null);
  cachedSlugs = signal<Set<string>>(new Set());
  billingReference = signal<Record<string, BillingMethodSpec>>({});
  activeFilter = signal<ModelCategoryFilter>('all');
  searchQuery = signal<string>('');
  loading = signal<boolean>(false);
  refreshing = signal<boolean>(false);

  // Active Defaults & Model Roles
  activeDefaults = signal<ResolvedActiveModels | null>(null);

  // Billing Guide Modal / Drawer Tab
  showBillingGuide = signal<boolean>(false);

  // Category Configuration Modal / Drawer
  showCategorySettings = signal<boolean>(false);
  categoryMetadata = signal<CategoryMetadataResponse | null>(null);
  selectedCategories = signal<string[]>([
    'partner-llm',
    'llm',
    'llm-reasoning',
    'chat',
    'text-to-image',
    'image-to-image',
    'image-editing',
    'image-to-video',
    'text-to-video',
  ]);
  savingCategories = signal<boolean>(false);

  // Notifications
  notification = signal<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Selected model for detail drawer
  selectedModel = signal<ModelSummary | null>(null);
  selectedDetailResponse = signal<CachedModelDetailResponse | null>(null);
  loadingDetails = signal<boolean>(false);
  activeDetailTab = signal<'specs' | 'pricing' | 'schema' | 'raw'>('specs');

  // View mode: default to compact tabular display so many models and costs can be seen at once
  viewMode = signal<'table' | 'grid'>('table');

  // Local llama.cpp status & config
  localLlmModelsUrl = signal<string>('http://localhost:8080/models');
  localLlmEnabled = signal<boolean>(true);
  localLlmOnline = signal<boolean>(false);
  localLlmCount = signal<number>(0);
  localLlmFirstSlug = signal<string>('');
  editingLocalUrl = signal<boolean>(false);
  checkingLocalLlm = signal<boolean>(false);

  // Pagination for smooth rendering of hundreds of models
  currentPage = signal<number>(1);
  pageSize = computed<number>(() => (this.viewMode() === 'table' ? 80 : 24));

  // Filtered list
  filteredModels = computed(() => {
    let list = this.models();
    const filter = this.activeFilter();
    const q = this.searchQuery().trim().toLowerCase();

    if (filter !== 'all') {
      list = list.filter((m) => m.type === filter);
    }

    if (q) {
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.slug.toLowerCase().includes(q) ||
          m.slugowner.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.pricing?.headlineBadge?.toLowerCase().includes(q) ||
          m.pricing?.subtext?.toLowerCase().includes(q) ||
          m.pricing?.primaryMethodName?.toLowerCase().includes(q),
      );
    }

    return list;
  });

  paginatedModels = computed(() => {
    const list = this.filteredModels();
    const start = (this.currentPage() - 1) * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });

  totalPages = computed(() => {
    return Math.max(1, Math.ceil(this.filteredModels().length / this.pageSize()));
  });

  ngOnInit() {
    this.loadCatalog();
    this.loadCachedSlugs();
    this.loadBillingReference();
    this.loadCategoryMetadata();
    this.loadDefaults();
    this.loadLocalLlm(false);
  }

  setViewMode(mode: 'table' | 'grid') {
    this.viewMode.set(mode);
    this.currentPage.set(1);
  }

  loadLocalLlm(refresh = false) {
    this.checkingLocalLlm.set(true);
    this.modelsService.getLocalLlm(refresh).subscribe({
      next: (res) => {
        this.checkingLocalLlm.set(false);
        this.localLlmEnabled.set(res.config.enabled);
        this.localLlmModelsUrl.set(res.config.modelsUrl);
        this.localLlmOnline.set(res.online);
        this.localLlmCount.set(res.models?.length || 0);
        this.localLlmFirstSlug.set(res.models?.[0]?.slug || '');
        if (refresh) {
          this.loadCatalog();
        }
      },
      error: () => {
        this.checkingLocalLlm.set(false);
        this.localLlmOnline.set(false);
      },
    });
  }

  saveLocalLlmSettings() {
    const url = this.localLlmModelsUrl().trim() || 'http://localhost:8080/models';
    this.checkingLocalLlm.set(true);
    this.modelsService
      .updateLocalLlm({
        enabled: this.localLlmEnabled(),
        modelsUrl: url,
      })
      .subscribe({
        next: (res) => {
          this.checkingLocalLlm.set(false);
          this.editingLocalUrl.set(false);
          this.localLlmOnline.set(res.online);
          this.localLlmCount.set(res.models?.length || 0);
          this.localLlmFirstSlug.set(res.models?.[0]?.slug || '');
          this.loadCatalog();
          this.notification.set({
            type: res.online ? 'success' : 'info',
            message: res.online
              ? `🖥️ Connected to local llama.cpp at ${res.config.modelsUrl} (${res.models.length} model detected).`
              : `Saved local llama.cpp URL (${res.config.modelsUrl}), currently offline.`,
          });
        },
        error: (err) => {
          this.checkingLocalLlm.set(false);
          this.notification.set({
            type: 'error',
            message: err.error?.message || 'Failed to update local llama.cpp configuration.',
          });
        },
      });
  }

  loadDefaults() {
    this.modelsService.getActiveDefaults().subscribe({
      next: (res) => this.activeDefaults.set(res),
      error: (err) => console.error('Failed to load active defaults in catalog', err),
    });
  }

  isSystemDefault(m: ModelSummary): boolean {
    const d = this.activeDefaults()?.system;
    if (!d) return false;
    return (
      d.chatModel === m.slug ||
      d.textToImageModel === m.slug ||
      d.imageToImageModel === m.slug ||
      d.chatModel === m.id ||
      d.textToImageModel === m.id ||
      d.imageToImageModel === m.id
    );
  }

  isUserPreferred(m: ModelSummary): boolean {
    const u = this.activeDefaults()?.user;
    if (!u) return false;
    return (
      u.chatModel === m.slug ||
      u.textToImageModel === m.slug ||
      u.imageToImageModel === m.slug ||
      u.chatModel === m.id ||
      u.textToImageModel === m.id ||
      u.imageToImageModel === m.id
    );
  }

  setAsSystemDefault(m: ModelSummary) {
    let payload: any = {};
    if (m.type === 'chat') payload = { chatModel: m.slug };
    else if (m.type === 'text-to-image') payload = { textToImageModel: m.slug };
    else if (m.type === 'image-to-image') payload = { imageToImageModel: m.slug };
    else return;

    this.modelsService.updateSystemDefaults(payload).subscribe({
      next: (res) => {
        this.activeDefaults.set(res);
        this.notification.set({
          type: 'success',
          message: `👑 Model '${m.title}' set as Tavern System Default for ${m.type}!`,
        });
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || 'Failed to update system default.',
        });
      },
    });
  }

  setAsUserPreferred(m: ModelSummary) {
    let payload: any = {};
    if (m.type === 'chat') payload = { chatModel: m.slug };
    else if (m.type === 'text-to-image') payload = { textToImageModel: m.slug };
    else if (m.type === 'image-to-image') payload = { imageToImageModel: m.slug };
    else return;

    this.modelsService.updateUserDefaults(payload).subscribe({
      next: (res) => {
        this.activeDefaults.set(res);
        this.notification.set({
          type: 'success',
          message: `🎯 Model '${m.title}' set as your Preferred Model for ${m.type}!`,
        });
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || 'Failed to set preferred model.',
        });
      },
    });
  }

  revertUserPreference(m: ModelSummary) {
    let payload: any = {};
    if (m.type === 'chat') payload = { chatModel: null };
    else if (m.type === 'text-to-image') payload = { textToImageModel: null };
    else if (m.type === 'image-to-image') payload = { imageToImageModel: null };
    else return;

    this.modelsService.updateUserDefaults(payload).subscribe({
      next: (res) => {
        this.activeDefaults.set(res);
        this.notification.set({
          type: 'info',
          message: `↺ Reverted ${m.type} model to Tavern Admin default.`,
        });
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || 'Failed to revert model preference.',
        });
      },
    });
  }

  loadCategoryMetadata() {
    this.modelsService.getCategories().subscribe({
      next: (res) => {
        this.categoryMetadata.set(res);
        if (res.selectedCategories && res.selectedCategories.length > 0) {
          this.selectedCategories.set(res.selectedCategories);
        }
      },
      error: (err) => {
        console.error('Failed to load category metadata', err);
      },
    });
  }

  isCategorySelected(cat: string): boolean {
    return this.selectedCategories().includes(cat);
  }

  toggleCategory(cat: string) {
    const current = this.selectedCategories();
    if (current.includes(cat)) {
      this.selectedCategories.set(current.filter((c) => c !== cat));
    } else {
      this.selectedCategories.set([...current, cat]);
    }
  }

  toggleCategoryGroup(group: CategoryGroup) {
    const current = new Set(this.selectedCategories());
    const allIn = group.categories.every((c) => current.has(c));
    if (allIn) {
      // Remove all in group
      group.categories.forEach((c) => current.delete(c));
    } else {
      // Add all in group
      group.categories.forEach((c) => current.add(c));
    }
    this.selectedCategories.set(Array.from(current));
  }

  resetDefaultCategories() {
    this.selectedCategories.set([
      'partner-llm',
      'llm',
      'llm-reasoning',
      'chat',
      'text-to-image',
      'image-to-image',
      'image-editing',
      'image-to-video',
      'text-to-video',
    ]);
  }

  saveCategories(syncImmediately = false) {
    const cats = this.selectedCategories();
    if (cats.length === 0) {
      this.notification.set({
        type: 'error',
        message: 'Please select at least one category to synchronize.',
      });
      return;
    }

    this.savingCategories.set(true);
    this.modelsService.updateCategories(cats).subscribe({
      next: (res) => {
        this.savingCategories.set(false);
        this.selectedCategories.set(res.selectedCategories);
        if (syncImmediately) {
          this.showCategorySettings.set(false);
          this.refreshFromWiro();
        } else {
          this.notification.set({
            type: 'success',
            message: `Selected categories updated (${cats.length} active).`,
          });
        }
      },
      error: (err) => {
        this.savingCategories.set(false);
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Failed to save categories: ${err.message}`,
        });
      },
    });
  }

  loadCatalog() {
    this.loading.set(true);
    this.modelsService.getCatalog().subscribe({
      next: (res) => {
        this.models.set(res.models);
        this.stats.set(res.stats);
        if (res.stats.selectedCategories && res.stats.selectedCategories.length > 0) {
          this.selectedCategories.set(res.stats.selectedCategories);
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notification.set({
          type: 'error',
          message: `Failed to load models catalog: ${err.message}`,
        });
      },
    });
  }

  loadCachedSlugs() {
    this.modelsService.getCachedSlugs().subscribe({
      next: (res) => {
        this.cachedSlugs.set(new Set(res.cachedSlugs || []));
      },
      error: (err) => {
        console.error('Failed to load cached slugs', err);
      },
    });
  }

  loadBillingReference() {
    this.modelsService.getBillingReference().subscribe({
      next: (res) => {
        this.billingReference.set(res.methods || {});
      },
      error: (err) => {
        console.error('Failed to load billing reference', err);
      },
    });
  }

  cleanSlug(val: string): string {
    return (val || 'unknown').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  }

  isModelCached(model: ModelSummary): boolean {
    const slugKey = `${this.cleanSlug(model.slugowner)}/${this.cleanSlug(model.slugproject)}`;
    return this.cachedSlugs().has(slugKey);
  }

  setFilter(filter: ModelCategoryFilter) {
    this.activeFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange() {
    this.currentPage.set(1);
  }

  clearSearch() {
    this.searchQuery.set('');
    this.currentPage.set(1);
  }

  refreshFromWiro() {
    if (!this.authService.hasWiroKey()) {
      this.notification.set({
        type: 'error',
        message: 'Admin Wiro.ai API key is missing. Please save your Wiro.ai API key in your profile first.',
      });
      return;
    }

    this.refreshing.set(true);
    const count = this.selectedCategories().length;
    this.notification.set({
      type: 'info',
      message: `Contacting api.wiro.ai to synchronize models across ${count} selected categories...`,
    });

    this.modelsService.refreshCatalog(this.selectedCategories()).subscribe({
      next: (res) => {
        this.refreshing.set(false);
        this.notification.set({
          type: 'success',
          message: res.message || 'Models successfully synchronized from Wiro.ai!',
        });
        this.loadCatalog();
        this.loadCachedSlugs();
      },
      error: (err) => {
        this.refreshing.set(false);
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Refresh failed: ${err.message}`,
        });
      },
    });
  }

  // Display or Refresh & Display specific model detail
  displayModel(model: ModelSummary, refresh = false) {
    this.selectedModel.set(model);
    this.selectedDetailResponse.set(null);
    this.loadingDetails.set(true);
    this.activeDetailTab.set('specs');

    this.modelsService.getModelDetail(model.slugowner, model.slugproject, refresh).subscribe({
      next: (res) => {
        this.selectedDetailResponse.set(res);
        this.loadingDetails.set(false);
        // Add to cached slugs set
        const slugKey = `${this.cleanSlug(model.slugowner)}/${this.cleanSlug(model.slugproject)}`;
        const updated = new Set(this.cachedSlugs());
        updated.add(slugKey);
        this.cachedSlugs.set(updated);
      },
      error: (err) => {
        this.loadingDetails.set(false);
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Failed to fetch details for ${model.title}: ${err.message}`,
        });
      },
    });
  }

  refreshCurrentDetail() {
    const m = this.selectedModel();
    if (!m) return;
    this.displayModel(m, true);
  }

  closeDetails() {
    this.selectedModel.set(null);
    this.selectedDetailResponse.set(null);
  }

  getCategoryBadgeClass(type: string): string {
    switch (type) {
      case 'chat':
        return 'badge-chat';
      case 'text-to-image':
        return 'badge-t2i';
      case 'image-to-image':
        return 'badge-i2i';
      case 'video':
        return 'badge-video';
      case 'voice':
        return 'badge-voice';
      default:
        return 'badge-other';
    }
  }

  getCategoryLabel(type: string): string {
    switch (type) {
      case 'chat':
        return '💬 Chat (LLM)';
      case 'text-to-image':
        return '🎨 Text-to-Image';
      case 'image-to-image':
        return '🖼️ Image-to-Image';
      case 'video':
        return '🎬 Video';
      case 'voice':
        return '🎙️ Voice';
      default:
        return '⚙️ Other';
    }
  }

  getPricingPillClass(pricing?: ModelPricingInfo): string {
    if (!pricing) return 'pill-neutral';
    switch (pricing.billingType) {
      case 'token-based':
        return 'pill-token';
      case 'flat':
        return 'pill-flat';
      case 'tiered':
        return 'pill-tiered';
      case 'approximate':
      case 'per-second':
        return 'pill-per-sec';
      default:
        return 'pill-neutral';
    }
  }

  formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString();
    } catch {
      return dateStr;
    }
  }

  objectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }
}
