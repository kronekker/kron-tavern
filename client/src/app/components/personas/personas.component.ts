import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PersonasService,
  PersonaItem,
  CreatePersonaDto,
  UpdatePersonaDto,
} from '../../services/personas.service';
import type { CreateSnippetInput } from '../../services/characters.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-personas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personas.component.html',
  styleUrls: ['./personas.component.scss'],
})
export class PersonasComponent implements OnInit {
  personasService = inject(PersonasService);
  authService = inject(AuthService);

  close = output<void>();

  // Tabs & Views
  activeTab = signal<'list' | 'editor'>('list');
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);

  // Persona list
  personas = signal<PersonaItem[]>([]);
  notification = signal<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Editor Form State
  isEditing = signal<boolean>(false);
  editingId = signal<string | null>(null);

  formName = signal<string>('');
  formAvatarUrl = signal<string>('');
  formDescription = signal<string>('');
  formSpeechStyle = signal<string>('');
  formIsDefault = signal<boolean>(false);
  formSnippets = signal<CreateSnippetInput[]>([]);

  ngOnInit() {
    this.loadPersonas();
  }

  loadPersonas() {
    this.loading.set(true);
    this.personasService.list().subscribe({
      next: (res) => {
        this.personas.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notification.set({
          type: 'error',
          message: `Failed to load personas: ${err.message}`,
        });
      },
    });
  }

  openCreateForm() {
    this.isEditing.set(false);
    this.editingId.set(null);
    this.formName.set('');
    this.formAvatarUrl.set('');
    this.formDescription.set('');
    this.formSpeechStyle.set('');
    this.formIsDefault.set(this.personas().length === 0);
    this.formSnippets.set([]);
    this.activeTab.set('editor');
  }

  openEditForm(persona: PersonaItem) {
    this.isEditing.set(true);
    this.editingId.set(persona.id);
    this.formName.set(persona.name);
    this.formAvatarUrl.set(persona.avatar_url || '');
    this.formDescription.set(persona.description);
    this.formSpeechStyle.set(persona.speech_style || '');
    this.formIsDefault.set(persona.is_default === 1);

    // Fetch full snippets
    this.personasService.get(persona.id).subscribe({
      next: (detail) => {
        const snips: CreateSnippetInput[] = (detail.snippets || []).map((s) => ({
          id: s.id,
          title: s.title,
          keywords: s.keywords,
          content: s.content,
          priority: s.priority,
          is_active: s.is_active === 1,
        }));
        this.formSnippets.set(snips);
      },
      error: () => {
        this.formSnippets.set([]);
      },
    });

    this.activeTab.set('editor');
  }

  addSnippet() {
    const list = this.formSnippets();
    this.formSnippets.set([
      ...list,
      {
        title: '',
        keywords: '',
        content: '',
        priority: 10,
        is_active: true,
      },
    ]);
  }

  removeSnippet(index: number) {
    const list = [...this.formSnippets()];
    list.splice(index, 1);
    this.formSnippets.set(list);
  }

  savePersona() {
    const name = this.formName().trim();
    const description = this.formDescription().trim();

    if (!name) {
      this.notification.set({ type: 'error', message: 'Persona Name is required.' });
      return;
    }
    if (!description) {
      this.notification.set({ type: 'error', message: 'Persona Description is required.' });
      return;
    }

    const cleanSnippets = this.formSnippets()
      .filter((s) => s.title?.trim() && s.keywords?.trim() && s.content?.trim())
      .map((s) => ({
        ...s,
        title: s.title.trim(),
        keywords: s.keywords.trim(),
        content: s.content.trim(),
        priority: Number(s.priority) || 10,
        is_active: s.is_active ? 1 : 0,
      }));

    this.saving.set(true);

    const payload: CreatePersonaDto = {
      name,
      avatar_url: this.formAvatarUrl().trim() || null,
      description,
      speech_style: this.formSpeechStyle().trim() || null,
      is_default: this.formIsDefault(),
      snippets: cleanSnippets,
    };

    if (this.isEditing() && this.editingId()) {
      this.personasService.update(this.editingId()!, payload).subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.notification.set({
            type: 'success',
            message: `Persona '${updated.name}' updated!`,
          });
          this.activeTab.set('list');
          this.loadPersonas();
        },
        error: (err) => {
          this.saving.set(false);
          this.notification.set({
            type: 'error',
            message: err.error?.message || `Failed to update persona: ${err.message}`,
          });
        },
      });
    } else {
      this.personasService.create(payload).subscribe({
        next: (created) => {
          this.saving.set(false);
          this.notification.set({
            type: 'success',
            message: `Persona '${created.name}' created!`,
          });
          this.activeTab.set('list');
          this.loadPersonas();
        },
        error: (err) => {
          this.saving.set(false);
          this.notification.set({
            type: 'error',
            message: err.error?.message || `Failed to create persona: ${err.message}`,
          });
        },
      });
    }
  }

  setDefault(persona: PersonaItem, event?: Event) {
    if (event) event.stopPropagation();
    if (persona.is_default) return;

    this.personasService.setDefault(persona.id).subscribe({
      next: () => {
        this.notification.set({
          type: 'success',
          message: `'${persona.name}' set as your default persona.`,
        });
        this.loadPersonas();
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Failed to set default persona: ${err.message}`,
        });
      },
    });
  }

  deletePersona(persona: PersonaItem, event?: Event) {
    if (event) event.stopPropagation();

    if (!confirm(`Are you sure you want to delete persona '${persona.name}'?`)) {
      return;
    }

    this.personasService.delete(persona.id).subscribe({
      next: () => {
        this.notification.set({
          type: 'success',
          message: `Persona '${persona.name}' deleted.`,
        });
        this.loadPersonas();
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Failed to delete persona: ${err.message}`,
        });
      },
    });
  }
}
