import { Component, OnInit, signal, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SessionsService, type SessionItem } from '../../services/sessions.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sessions-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sessions-modal.component.html',
  styleUrl: './sessions-modal.component.scss',
})
export class SessionsModalComponent implements OnInit {
  private sessionsService = inject(SessionsService);
  authService = inject(AuthService);

  // Inputs & Outputs
  currentSessionId = input<string | null>(null);
  close = output<void>();
  openSession = output<string>();
  startNewSession = output<void>();
  sessionDeleted = output<string>();

  // State Signals
  sessions = signal<SessionItem[]>([]);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  searchQuery = signal<string>('');
  deletingId = signal<string | null>(null);

  // Filtered Sessions
  filteredSessions = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const list = this.sessions();
    if (!query) return list;

    return list.filter((s) => {
      const matchTitle = (s.title || '').toLowerCase().includes(query);
      const matchChar = (s.character_name || '').toLowerCase().includes(query);
      const matchPersona = (s.persona_name || '').toLowerCase().includes(query);
      const matchLastMsg = (s.last_message || '').toLowerCase().includes(query);
      const matchModel = (s.chat_model || '').toLowerCase().includes(query);
      return matchTitle || matchChar || matchPersona || matchLastMsg || matchModel;
    });
  });

  ngOnInit() {
    this.loadSessions();
  }

  loadSessions() {
    this.loading.set(true);
    this.error.set(null);
    this.sessionsService.list().subscribe({
      next: (data) => {
        this.sessions.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to load chat sessions.');
        this.loading.set(false);
      },
    });
  }

  onSelectSession(session: SessionItem) {
    this.openSession.emit(session.id);
    this.close.emit();
  }

  onDeleteSession(session: SessionItem, event: Event) {
    event.stopPropagation();
    const confirmed = confirm(
      `Delete session with "${session.character_name || 'Companion'}"?\n\nThis will permanently delete the conversation history and turn traces.`,
    );
    if (!confirmed) return;

    this.deletingId.set(session.id);
    this.sessionsService.delete(session.id).subscribe({
      next: () => {
        this.sessions.update((list) => list.filter((s) => s.id !== session.id));
        this.deletingId.set(null);
        this.sessionDeleted.emit(session.id);
      },
      error: (err) => {
        this.deletingId.set(null);
        alert(err.error?.message || 'Failed to delete session.');
      },
    });
  }

  onStartNew() {
    this.close.emit();
    this.startNewSession.emit();
  }
}
