import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModelsService,
  ModelSummary,
  ModelCatalogStats,
  ModelCategoryFilter,
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
  activeFilter = signal<ModelCategoryFilter>('all');
  searchQuery = signal<string>('');
  loading = signal<boolean>(false);
  refreshing = signal<boolean>(false);

  // Notifications
  notification = signal<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Selected model for detail drawer
  selectedModelId = signal<string | null>(null);
  selectedModelDetails = signal<any | null>(null);
  loadingDetails = signal<boolean>(false);

  // Pagination for smooth rendering of hundreds of models
  currentPage = signal<number>(1);
  pageSize = signal<number>(24);

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
          m.description.toLowerCase().includes(q),
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
  }

  loadCatalog() {
    this.loading.set(true);
    this.modelsService.getCatalog().subscribe({
      next: (res) => {
        this.models.set(res.models);
        this.stats.set(res.stats);
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
    this.notification.set({
      type: 'info',
      message: 'Contacting api.wiro.ai to synchronize model catalog...',
    });

    this.modelsService.refreshCatalog().subscribe({
      next: (res) => {
        this.refreshing.set(false);
        this.notification.set({
          type: 'success',
          message: res.message || 'Models successfully synchronized from Wiro.ai!',
        });
        this.loadCatalog();
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

  inspectModel(model: ModelSummary) {
    this.selectedModelId.set(model.id);
    this.selectedModelDetails.set(null);
    this.loadingDetails.set(true);

    this.modelsService.getModelDetails(model.id).subscribe({
      next: (details) => {
        this.selectedModelDetails.set(details);
        this.loadingDetails.set(false);
      },
      error: () => {
        this.selectedModelDetails.set(model);
        this.loadingDetails.set(false);
      },
    });
  }

  closeDetails() {
    this.selectedModelId.set(null);
    this.selectedModelDetails.set(null);
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

  parseDynamicPrice(dynamicprice: any): any[] {
    if (!dynamicprice) return [];
    try {
      if (typeof dynamicprice === 'string') {
        return JSON.parse(dynamicprice);
      }
      return Array.isArray(dynamicprice) ? dynamicprice : [];
    } catch {
      return [];
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
}
