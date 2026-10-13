import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CharactersService,
  CharacterItem,
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateSnippetInput,
  KeywordSnippet,
} from '../../services/characters.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-characters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './characters.component.html',
  styleUrls: ['./characters.component.scss'],
})
export class CharactersComponent implements OnInit {
  charactersService = inject(CharactersService);
  authService = inject(AuthService);

  close = output<void>();
  startChat = output<CharacterItem>();

  // Tabs & Views
  activeTab = signal<'public' | 'mine' | 'editor'>('public');
  searchQuery = signal<string>('');
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);

  // Character list
  characters = signal<CharacterItem[]>([]);
  notification = signal<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Editor Form State
  isEditing = signal<boolean>(false);
  editingId = signal<string | null>(null);

  formName = signal<string>('');
  formTagline = signal<string>('');
  formAvatarUrl = signal<string>('');
  formGreeting = signal<string>('');
  formSystemPrompt = signal<string>('');
  formScenario = signal<string>('');
  formDialogueExamples = signal<string>('');
  formIsPublic = signal<boolean>(false);
  formDefaultModel = signal<string>('');
  formTemperature = signal<number>(0.8);
  formSnippets = signal<CreateSnippetInput[]>([]);

  // Filtered list
  filteredCharacters = computed(() => {
    const list = this.characters();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.tagline && c.tagline.toLowerCase().includes(q)) ||
        (c.creator_name && c.creator_name.toLowerCase().includes(q)) ||
        c.system_prompt.toLowerCase().includes(q),
    );
  });

  ngOnInit() {
    this.loadCharacters();
  }

  setTab(tab: 'public' | 'mine' | 'editor') {
    if (tab === 'editor') {
      if (!this.authService.isAuthenticated()) {
        this.notification.set({
          type: 'error',
          message: 'Please sign in to create or edit AI characters.',
        });
        return;
      }
      this.openCreateForm();
      return;
    }

    this.activeTab.set(tab);
    this.loadCharacters();
  }

  loadCharacters() {
    this.loading.set(true);
    const scope = this.activeTab() === 'mine' ? 'mine' : 'public';

    this.charactersService.list(scope, this.searchQuery()).subscribe({
      next: (res) => {
        this.characters.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notification.set({
          type: 'error',
          message: `Failed to load characters: ${err.message}`,
        });
      },
    });
  }

  openCreateForm() {
    this.isEditing.set(false);
    this.editingId.set(null);
    this.formName.set('');
    this.formTagline.set('');
    this.formAvatarUrl.set('');
    this.formGreeting.set('');
    this.formSystemPrompt.set('');
    this.formScenario.set('');
    this.formDialogueExamples.set('');
    this.formIsPublic.set(false);
    this.formDefaultModel.set('');
    this.formTemperature.set(0.8);
    this.formSnippets.set([]);
    this.activeTab.set('editor');
  }

  openEditForm(char: CharacterItem) {
    if (!this.canEdit(char)) {
      this.notification.set({
        type: 'error',
        message: 'You can only edit characters you created.',
      });
      return;
    }

    this.isEditing.set(true);
    this.editingId.set(char.id);
    this.formName.set(char.name);
    this.formTagline.set(char.tagline || '');
    this.formAvatarUrl.set(char.avatar_url || '');
    this.formGreeting.set(char.greeting);
    this.formSystemPrompt.set(char.system_prompt);
    this.formScenario.set(char.scenario || '');
    this.formDialogueExamples.set(char.dialogue_examples || '');
    this.formIsPublic.set(char.is_public === 1);
    this.formDefaultModel.set(char.default_model || '');
    this.formTemperature.set(char.temperature ?? 0.8);

    // Fetch full snippets for character
    this.charactersService.get(char.id).subscribe({
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

  // Snippet List Management in Form
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

  saveCharacter() {
    const name = this.formName().trim();
    const greeting = this.formGreeting().trim();
    const systemPrompt = this.formSystemPrompt().trim();

    if (!name) {
      this.notification.set({ type: 'error', message: 'Character Name is required.' });
      return;
    }
    if (!greeting) {
      this.notification.set({ type: 'error', message: 'Opening Greeting is required.' });
      return;
    }
    if (!systemPrompt) {
      this.notification.set({ type: 'error', message: 'Personality / System Prompt is required.' });
      return;
    }

    // Filter valid snippets
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

    const payload: CreateCharacterDto = {
      name,
      tagline: this.formTagline().trim() || null,
      avatar_url: this.formAvatarUrl().trim() || null,
      greeting,
      system_prompt: systemPrompt,
      scenario: this.formScenario().trim() || null,
      dialogue_examples: this.formDialogueExamples().trim() || null,
      is_public: this.formIsPublic(),
      default_model: this.formDefaultModel().trim() || null,
      temperature: this.formTemperature(),
      snippets: cleanSnippets,
    };

    if (this.isEditing() && this.editingId()) {
      this.charactersService.update(this.editingId()!, payload).subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.notification.set({
            type: 'success',
            message: `Character '${updated.name}' updated successfully!`,
          });
          this.activeTab.set(updated.is_public ? 'public' : 'mine');
          this.loadCharacters();
        },
        error: (err) => {
          this.saving.set(false);
          this.notification.set({
            type: 'error',
            message: err.error?.message || `Failed to update character: ${err.message}`,
          });
        },
      });
    } else {
      this.charactersService.create(payload).subscribe({
        next: (created) => {
          this.saving.set(false);
          this.notification.set({
            type: 'success',
            message: `Character '${created.name}' created successfully!`,
          });
          this.activeTab.set(created.is_public ? 'public' : 'mine');
          this.loadCharacters();
        },
        error: (err) => {
          this.saving.set(false);
          this.notification.set({
            type: 'error',
            message: err.error?.message || `Failed to create character: ${err.message}`,
          });
        },
      });
    }
  }

  deleteCharacter(char: CharacterItem, event?: Event) {
    if (event) event.stopPropagation();
    if (!this.canEdit(char)) return;

    if (!confirm(`Are you sure you want to delete character '${char.name}'?`)) {
      return;
    }

    this.charactersService.delete(char.id).subscribe({
      next: () => {
        this.notification.set({
          type: 'success',
          message: `Character '${char.name}' deleted.`,
        });
        this.loadCharacters();
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Failed to delete character: ${err.message}`,
        });
      },
    });
  }

  canEdit(char: CharacterItem): boolean {
    const cur = this.authService.currentUser();
    if (!cur) return false;
    return cur.id === char.creator_id || !!cur.isAdmin;
  }
}
