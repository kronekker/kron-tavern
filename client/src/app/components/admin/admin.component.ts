import { Component, OnInit, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AdminService,
  DatabaseStats,
  TableSummary,
  TableDataResponse,
  TableColumnInfo,
} from '../../services/admin.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent implements OnInit {
  private adminService = inject(AdminService);

  // Close event for modal / drawer
  close = output<void>();

  // State signals
  stats = signal<DatabaseStats | null>(null);
  tables = signal<TableSummary[]>([]);
  activeTab = signal<'overview' | 'tables'>('overview');
  selectedTable = signal<string>('users');
  tableData = signal<TableDataResponse | null>(null);
  currentPage = signal<number>(1);
  pageSize = signal<number>(15);

  loading = signal<boolean>(false);
  actionMessage = signal<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Selected JSON payload for inspection
  inspectedJson = signal<{ title: string; data: any } | null>(null);

  ngOnInit() {
    this.refreshAll();
  }

  refreshAll() {
    this.loadStats();
    this.loadTables();
    if (this.selectedTable()) {
      this.loadTableData(this.selectedTable(), this.currentPage());
    }
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
