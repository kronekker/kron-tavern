import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DatabaseStats {
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  sqliteVersion: string;
  sqliteVecVersion: string;
  journalMode: string;
  tableCounts: Record<string, number>;
}

export interface TableSummary {
  name: string;
  count: number;
}

export interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

export interface TableDataResponse {
  tableName: string;
  columns: TableColumnInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rows: any[];
}

@Injectable({
  providedIn: 'root',
})
export class AdminService {
  private http = inject(HttpClient);
  private baseUrl = '/api/admin';

  getStats(): Observable<DatabaseStats> {
    return this.http.get<DatabaseStats>(`${this.baseUrl}/stats`);
  }

  getTables(): Observable<TableSummary[]> {
    return this.http.get<TableSummary[]>(`${this.baseUrl}/tables`);
  }

  getTableData(tableName: string, page = 1, pageSize = 20): Observable<TableDataResponse> {
    return this.http.get<TableDataResponse>(
      `${this.baseUrl}/tables/${tableName}?page=${page}&pageSize=${pageSize}`,
    );
  }

  deleteRecord(tableName: string, id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.baseUrl}/tables/${tableName}/${id}`,
    );
  }

  runVacuum(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.baseUrl}/maintenance/vacuum`,
      {},
    );
  }

  runIntegrityCheck(): Observable<{ success: boolean; result: any[] }> {
    return this.http.get<{ success: boolean; result: any[] }>(
      `${this.baseUrl}/maintenance/integrity-check`,
    );
  }

  seedDemo(): Observable<{ message: string; seeded: Record<string, number> }> {
    return this.http.post<{ message: string; seeded: Record<string, number> }>(
      `${this.baseUrl}/seed-demo`,
      {},
    );
  }
}
