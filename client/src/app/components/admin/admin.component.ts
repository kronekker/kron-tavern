import { Component, OnInit, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  DatabaseStats,
  TableSummary,
  TableDataResponse,
  TableColumnInfo,
} from '../../services/admin.service';
import {
  ModelsService,
  ModelCatalogStats,
  ModelSummary,
  ResolvedActiveModels,
} from '../../services/models.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent implements OnInit {
  private adminService = inject(AdminService);
  private modelsService = inject(ModelsService);
  authService = inject(AuthService);

  // Close & navigation events
  close = output<void>();
  openModels = output<void>();

  // State signals
  stats = signal<DatabaseStats | null>(null);
  modelsStats = signal<ModelCatalogStats | null>(null);
  tables = signal<TableSummary[]>([]);
  activeTab = signal<'overview' | 'tables'>('overview');
  selectedTable = signal<string>('users');
  tableData = signal<TableDataResponse | null>(null);
  currentPage = signal<number>(1);
  pageSize = signal<number>(15);

  // System Default Models signals
  activeDefaults = signal<ResolvedActiveModels | null>(null);
  chatModels = signal<ModelSummary[]>([]);
  textToImageModels = signal<ModelSummary[]>([]);
  imageToImageModels = signal<ModelSummary[]>([]);
  selectedDefaultChat = signal<string>('');
  selectedDefaultT2I = signal<string>('');
  selectedDefaultI2I = signal<string>('');
  savingDefaults = signal<boolean>(false);

  loading = signal<boolean>(false);
  refreshingModels = signal<boolean>(false);
  actionMessage = signal<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Selected JSON payload for inspection
  inspectedJson = signal<{ title: string; data: any } | null>(null);

  ngOnInit() {
    this.refreshAll();
  }

  refreshAll() {
    this.loadStats();
    this.loadModelsStats();
    this.loadTables();
    this.loadDefaultsAndModels();
    if (this.selectedTable()) {
      this.loadTableData(this.selectedTable(), this.currentPage());
    }
  }

  loadDefaultsAndModels() {
    this.modelsService.getActiveDefaults().subscribe({
      next: (res) => {
        this.activeDefaults.set(res);
        this.selectedDefaultChat.set(res.system.chatModel);
        this.selectedDefaultT2I.set(res.system.textToImageModel);
        this.selectedDefaultI2I.set(res.system.imageToImageModel);
      },
      error: (err) => console.error('Failed to load active defaults', err),
    });

    this.modelsService.getCatalog('all').subscribe({
      next: (res) => {
        this.chatModels.set(res.models.filter((m) => m.type === 'chat'));
        this.textToImageModels.set(res.models.filter((m) => m.type === 'text-to-image'));
        this.imageToImageModels.set(res.models.filter((m) => m.type === 'image-to-image'));
      },
      error: (err) => console.error('Failed to load catalog models', err),
    });
  }

  saveSystemDefaults() {
    this.savingDefaults.set(true);
    this.modelsService
      .updateSystemDefaults({
        chatModel: this.selectedDefaultChat(),
        textToImageModel: this.selectedDefaultT2I(),
        imageToImageModel: this.selectedDefaultI2I(),
      })
      .subscribe({
        next: (res) => {
          this.savingDefaults.set(false);
          this.activeDefaults.set(res);
          this.actionMessage.set({
            type: 'success',
            text: 'System default models updated successfully! All users will inherit these defaults unless they set personal overrides.',
          });
        },
        error: (err) => {
          this.savingDefaults.set(false);
          this.actionMessage.set({
            type: 'error',
            text: err.error?.message || `Failed to update system defaults: ${err.message}`,
          });
        },
      });
  }

  getSelectedChatSummary(): ModelSummary | undefined {
    const slugOrId = this.selectedDefaultChat();
    return this.chatModels().find((m) => m.slug === slugOrId || m.id === slugOrId);
  }

  getSelectedT2ISummary(): ModelSummary | undefined {
    const slugOrId = this.selectedDefaultT2I();
    return this.textToImageModels().find((m) => m.slug === slugOrId || m.id === slugOrId);
  }

  getSelectedI2ISummary(): ModelSummary | undefined {
    const slugOrId = this.selectedDefaultI2I();
    return this.imageToImageModels().find((m) => m.slug === slugOrId || m.id === slugOrId);
  }

  loadModelsStats() {
    this.modelsService.getStats().subscribe({
      next: (res) => {
        this.modelsStats.set(res);
      },
      error: (err) => {
        console.error('Failed to load models stats', err);
      },
    });
  }

  refreshWiroModels() {
    if (!this.authService.hasWiroKey()) {
      this.actionMessage.set({
        type: 'error',
        text: 'Admin Wiro.ai API key is missing. Please save your personal Wiro key in your profile first.',
      });
      return;
    }

    this.refreshingModels.set(true);
    this.actionMessage.set({
      type: 'info',
      text: 'Synchronizing model catalog from Wiro.ai (Tool/List)...',
    });

    this.modelsService.refreshCatalog().subscribe({
      next: (res) => {
        this.refreshingModels.set(false);
        this.modelsStats.set(res.stats);
        this.actionMessage.set({
          type: 'success',
          text: res.message || 'Models catalog refreshed successfully.',
        });
      },
      error: (err) => {
        this.refreshingModels.set(false);
        this.actionMessage.set({
          type: 'error',
          text: err.error?.message || `Failed to refresh models: ${err.message}`,
        });
      },
    });
  }

  loadStats() {
    this.loading.set(true);
    this.adminService.getStats().subscribe({
      next: (res) => {
        this.stats.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.actionMessage.set({
          type: 'error',
          text: `Failed to load database stats: ${err.message}`,
        });
        this.loading.set(false);
      },
    });
  }

  loadTables() {
    this.adminService.getTables().subscribe({
      next: (res) => {
        this.tables.set(res);
      },
      error: (err) => {
        console.error('Failed to load tables', err);
      },
    });
  }

  selectTable(tableName: string) {
    this.selectedTable.set(tableName);
    this.currentPage.set(1);
    this.loadTableData(tableName, 1);
  }

  loadTableData(tableName: string, page = 1) {
    this.loading.set(true);
    this.adminService.getTableData(tableName, page, this.pageSize()).subscribe({
      next: (res) => {
        this.tableData.set(res);
        this.currentPage.set(res.page);
        this.loading.set(false);
      },
      error: (err) => {
        this.actionMessage.set({
          type: 'error',
          text: `Error loading table '${tableName}': ${err.message}`,
        });
        this.loading.set(false);
      },
    });
  }

  changePage(newPage: number) {
    const data = this.tableData();
    if (!data || newPage < 1 || newPage > data.totalPages) return;
    this.loadTableData(this.selectedTable(), newPage);
  }

  deleteRow(id: string) {
    if (!confirm(`Are you sure you want to delete row '${id}' from ${this.selectedTable()}?`)) {
      return;
    }
    this.loading.set(true);
    this.adminService.deleteRecord(this.selectedTable(), id).subscribe({
      next: (res) => {
        this.actionMessage.set({ type: 'success', text: res.message });
        this.refreshAll();
      },
      error: (err) => {
        this.actionMessage.set({ type: 'error', text: `Delete failed: ${err.message}` });
        this.loading.set(false);
      },
    });
  }

  runVacuum() {
    this.loading.set(true);
    this.adminService.runVacuum().subscribe({
      next: (res) => {
        this.actionMessage.set({ type: 'success', text: res.message });
        this.loadStats();
      },
      error: (err) => {
        this.actionMessage.set({ type: 'error', text: `VACUUM failed: ${err.message}` });
        this.loading.set(false);
      },
    });
  }

  runIntegrityCheck() {
    this.loading.set(true);
    this.adminService.runIntegrityCheck().subscribe({
      next: (res) => {
        this.actionMessage.set({
          type: 'info',
          text: `Integrity check result: ${JSON.stringify(res.result)}`,
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.actionMessage.set({
          type: 'error',
          text: `Integrity check failed: ${err.message}`,
        });
        this.loading.set(false);
      },
    });
  }

  seedDemo() {
    this.loading.set(true);
    this.adminService.seedDemo().subscribe({
      next: (res) => {
        this.actionMessage.set({ type: 'success', text: res.message });
        this.refreshAll();
      },
      error: (err) => {
        this.actionMessage.set({ type: 'error', text: `Seed failed: ${err.message}` });
        this.loading.set(false);
      },
    });
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  isJsonString(val: any): boolean {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }

  inspectValue(title: string, val: any) {
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      this.inspectedJson.set({ title, data: parsed });
    } catch {
      this.inspectedJson.set({ title, data: val });
    }
  }

  closeJsonInspector() {
    this.inspectedJson.set(null);
  }

  getTotalRecordCount(): number {
    const s = this.stats();
    if (!s) return 0;
    return Object.values(s.tableCounts).reduce((a, b) => a + b, 0);
  }
}
