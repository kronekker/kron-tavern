import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CharactersService,
  CharacterItem,
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateSnippetInput,
} from '../../services/characters.service';
import { AuthService } from '../../services/auth.service';
import { ImagesService, GeneratedImageItem } from '../../services/images.service';
import { ModelsService, ModelSummary } from '../../services/models.service';
import { ModelPickerTableComponent } from '../model-picker-table/model-picker-table.component';

@Component({
  selector: 'app-characters',
  standalone: true,
  imports: [CommonModule, FormsModule, ModelPickerTableComponent],
  templateUrl: './characters.component.html',
  styleUrls: ['./characters.component.scss'],
})
export class CharactersComponent implements OnInit {
  charactersService = inject(CharactersService);
  authService = inject(AuthService);
  imagesService = inject(ImagesService);
  modelsService = inject(ModelsService);

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
  formAvatarPrompt = signal<string>('');
  formGreeting = signal<string>('');
  formSystemPrompt = signal<string>('');
  formScenario = signal<string>('');
  formDialogueExamples = signal<string>('');
  formIsPublic = signal<boolean>(false);
  formDefaultModel = signal<string>('');
  formTemperature = signal<number>(0.8);
  formSnippets = signal<CreateSnippetInput[]>([]);

  // Avatar T2I Generation State
  generatingAvatar = signal<boolean>(false);
  avatarAspectRatio = signal<string>('1:1');
  selectedT2IModel = signal<string>('');
  showT2IModelPicker = signal<boolean>(false);
  t2iModels = signal<ModelSummary[]>([]);
  showSavedAvatars = signal<boolean>(false);
  savedImages = signal<GeneratedImageItem[]>([]);

  resolvedSelectedT2IModel = computed(() => {
    const slug = this.selectedT2IModel();
    const list = this.t2iModels();
    if (!slug) return list[0] || null;
    const t = slug.trim().toLowerCase();
    return (
      list.find(
        (m) =>
          m.slug.toLowerCase() === t ||
          m.id.toLowerCase() === t ||
          m.title.toLowerCase() === t,
      ) || null
    );
  });

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
    this.loadT2IModels();
  }

  loadT2IModels() {
    this.modelsService.getCatalog('text-to-image').subscribe({
      next: (res) => this.t2iModels.set(res.models || []),
    });
    this.modelsService.getActiveDefaults().subscribe({
      next: (active) => {
        if (!this.selectedT2IModel()) {
          this.selectedT2IModel.set(active.effective.textToImageModel);
        }
      },
    });
  }

  loadSavedImages() {
    if (!this.authService.isAuthenticated()) return;
    this.imagesService.listImages().subscribe({
      next: (imgs) => this.savedImages.set(imgs),
    });
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
    this.formAvatarPrompt.set('');
    this.formGreeting.set('');
    this.formSystemPrompt.set('');
    this.formScenario.set('');
    this.formDialogueExamples.set('');
    this.formIsPublic.set(false);
    this.formDefaultModel.set('');
    this.formTemperature.set(0.8);
    this.formSnippets.set([]);
    this.showT2IModelPicker.set(false);
    this.showSavedAvatars.set(false);
    this.loadSavedImages();
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
    this.formAvatarPrompt.set(char.avatar_prompt || '');
    this.formGreeting.set(char.greeting);
    this.formSystemPrompt.set(char.system_prompt);
    this.formScenario.set(char.scenario || '');
    this.formDialogueExamples.set(char.dialogue_examples || '');
    this.formIsPublic.set(char.is_public === 1);
    this.formDefaultModel.set(char.default_model || '');
    this.formTemperature.set(char.temperature ?? 0.8);
    this.showT2IModelPicker.set(false);
    this.showSavedAvatars.set(false);
    this.loadSavedImages();

    // Fetch full snippets for character
    this.charactersService.get(char.id).subscribe({
      next: (detail) => {
        if (detail.avatar_prompt && !this.formAvatarPrompt()) {
          this.formAvatarPrompt.set(detail.avatar_prompt);
        }
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

  draftAvatarPromptFromCharacter() {
    const name = this.formName().trim() || 'fantasy character';
    const tagline = this.formTagline().trim();
    const personality = this.formSystemPrompt().trim().slice(0, 220);
    const scenario = this.formScenario().trim().slice(0, 140);

    const parts = [
      `Detailed character portrait of ${name}${tagline ? ', ' + tagline : ''}.`,
    ];
    if (personality) {
      parts.push(`Appearance & vibe: ${personality}`);
    }
    if (scenario) {
      parts.push(`Setting: ${scenario}`);
    }
    parts.push('High quality digital character concept art, expressive lighting, sharp focus.');
    this.formAvatarPrompt.set(parts.join(' '));
  }

  generateCharacterAvatar() {
    const prompt = this.formAvatarPrompt().trim();
    if (!prompt) {
      this.notification.set({
        type: 'error',
        message: 'Please enter a visual description for the avatar (or click Auto-Draft).',
      });
      return;
    }

    this.generatingAvatar.set(true);
    this.notification.set({
      type: 'info',
      message: 'Generating character portrait via Text-to-Image LLM... This may take 5–25 seconds.',
    });

    const charId = this.editingId();
    const model = this.selectedT2IModel() || undefined;
    const aspectRatio = this.avatarAspectRatio() || '1:1';

    if (this.isEditing() && charId) {
      // Generate & immediately save onto existing character record
      this.charactersService
        .generateAvatar(charId, { prompt, model, aspectRatio })
        .subscribe({
          next: (res) => {
            this.generatingAvatar.set(false);
            this.formAvatarUrl.set(res.character.avatar_url || res.image.image_url);
            this.formAvatarPrompt.set(res.character.avatar_prompt || prompt);
            this.loadSavedImages();
            this.loadCharacters();
            this.notification.set({
              type: 'success',
              message: `Generated and saved new avatar for '${res.character.name}'!`,
            });
          },
          error: (err) => {
            this.generatingAvatar.set(false);
            this.notification.set({
              type: 'error',
              message:
                err.error?.message || `Avatar generation failed: ${err.message}`,
            });
          },
        });
    } else {
      // Creating a new character not yet in DB: generate into store and populate formAvatarUrl
      this.imagesService
        .generateTextToImage({
          prompt,
          model,
          aspectRatio,
          mode: 'avatar',
        })
        .subscribe({
          next: (img) => {
            this.generatingAvatar.set(false);
            this.formAvatarUrl.set(img.image_url);
            this.loadSavedImages();
            this.notification.set({
              type: 'success',
              message: 'Avatar generated and saved to backend store! Click Create Character to finish.',
            });
          },
          error: (err) => {
            this.generatingAvatar.set(false);
            this.notification.set({
              type: 'error',
              message:
                err.error?.message || `Avatar generation failed: ${err.message}`,
            });
          },
        });
    }
  }

  selectSavedAvatar(img: GeneratedImageItem) {
    this.formAvatarUrl.set(img.image_url);
    if (img.prompt) {
      this.formAvatarPrompt.set(img.prompt);
    }
    this.notification.set({
      type: 'info',
      message: 'Selected image applied to Avatar URL. Save character to persist.',
    });
  }

  deleteSavedImage(img: GeneratedImageItem, event: Event) {
    event.stopPropagation();
    this.imagesService.deleteImage(img.id).subscribe({
      next: () => {
        this.savedImages.update((list) => list.filter((i) => i.id !== img.id));
        if (this.formAvatarUrl() === img.image_url) {
          this.formAvatarUrl.set('');
        }
      },
    });
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
      avatar_prompt: this.formAvatarPrompt().trim() || null,
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
