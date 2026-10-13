import { Component, OnInit, inject, signal, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SessionsService } from '../../services/sessions.service';
import { CharactersService, CharacterItem } from '../../services/characters.service';
import { PersonasService, PersonaItem } from '../../services/personas.service';
import { ModelsService, ModelSummary } from '../../services/models.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-session-setup-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './session-setup-modal.component.html',
  styleUrls: ['./session-setup-modal.component.scss'],
})
export class SessionSetupModalComponent implements OnInit {
  private sessionsService = inject(SessionsService);
  private charactersService = inject(CharactersService);
  private personasService = inject(PersonasService);
  private modelsService = inject(ModelsService);
  public authService = inject(AuthService);

  initialCharacter = input<CharacterItem | null>(null);
  close = output<void>();
  created = output<string>();

  loading = signal<boolean>(true);
  creating = signal<boolean>(false);
  error = signal<string | null>(null);

  // Character list & selection
  charactersList = signal<CharacterItem[]>([]);
  selectedCharacterId = signal<string>('');

  // Persona list & selection
  personasList = signal<PersonaItem[]>([]);
  selectedPersonaId = signal<string>('');
  isCreatingQuickPersona = signal<boolean>(false);
  quickPersonaName = signal<string>('');
  quickPersonaDesc = signal<string>('');

  // Multimodal Models Triad
  showAdvancedModels = signal<boolean>(false);
  chatModel = signal<string>('');
  textToImageModel = signal<string>('');
  imageToImageModel = signal<string>('');

  chatModelsList = signal<ModelSummary[]>([]);
  textToImageModelsList = signal<ModelSummary[]>([]);
  imageToImageModelsList = signal<ModelSummary[]>([]);

  // Session metadata
  sessionTitle = signal<string>('');

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading.set(true);

    // 1. Load Defaults
    this.modelsService.getActiveDefaults().subscribe({
      next: (res) => {
        this.chatModel.set(res.effective.chatModel);
        this.textToImageModel.set(res.effective.textToImageModel);
        this.imageToImageModel.set(res.effective.imageToImageModel);
      },
    });

    // 2. Load Models Catalog
    this.modelsService.getCatalog('chat').subscribe({
      next: (res) => this.chatModelsList.set(res.models || []),
    });
    this.modelsService.getCatalog('text-to-image').subscribe({
      next: (res) => this.textToImageModelsList.set(res.models || []),
    });
    this.modelsService.getCatalog('image-to-image').subscribe({
      next: (res) => this.imageToImageModelsList.set(res.models || []),
    });

    // 3. Load Characters
    this.charactersService.list().subscribe({
      next: (chars) => {
        this.charactersList.set(chars);
        const initChar = this.initialCharacter();
        if (initChar) {
          this.selectedCharacterId.set(initChar.id);
          this.sessionTitle.set(`Chat with ${initChar.name}`);
        } else if (chars.length > 0) {
          this.selectedCharacterId.set(chars[0].id);
          this.sessionTitle.set(`Chat with ${chars[0].name}`);
        }
      },
    });

    // 4. Load Personas
    this.personasService.list().subscribe({
      next: (personas) => {
        this.personasList.set(personas);
        if (personas.length > 0) {
          const defaultPersona = personas.find((p) => p.is_default) || personas[0];
          this.selectedPersonaId.set(defaultPersona.id);
        } else {
          // No persona exists yet; suggest quick creation
          this.isCreatingQuickPersona.set(true);
          const currentUsername = this.authService.currentUser()?.username || 'Traveler';
          this.quickPersonaName.set(currentUsername);
          this.quickPersonaDesc.set(`A curious explorer wandering into the tavern.`);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  onCharacterChange(charId: string) {
    this.selectedCharacterId.set(charId);
    const char = this.charactersList().find((c) => c.id === charId);
    if (char) {
      this.sessionTitle.set(`Chat with ${char.name}`);
    }
  }

  createQuickPersonaAndStart() {
    const name = this.quickPersonaName().trim();
    const desc = this.quickPersonaDesc().trim();
    if (!name || !desc) {
      this.error.set('Persona name and description are required.');
      return;
    }

    this.creating.set(true);
    this.personasService
      .create({
        name,
        description: desc,
        is_default: true,
      })
      .subscribe({
        next: (created) => {
          this.personasList.update((list) => [...list, created]);
          this.selectedPersonaId.set(created.id);
          this.isCreatingQuickPersona.set(false);
          this.startSession();
        },
        error: (err) => {
          this.creating.set(false);
          this.error.set(err.error?.message || 'Failed to create persona.');
        },
      });
  }

  startSession() {
    this.error.set(null);
    const charId = this.selectedCharacterId();
    const personaId = this.selectedPersonaId();

    if (!charId) {
      this.error.set('Please select a character.');
      return;
    }

    if (!personaId) {
      if (this.isCreatingQuickPersona()) {
        this.createQuickPersonaAndStart();
        return;
      }
      this.error.set('Please select or create a persona.');
      return;
    }

    this.creating.set(true);
    this.sessionsService
      .create({
        characterId: charId,
        personaId,
        title: this.sessionTitle().trim() || undefined,
        chatModel: this.chatModel().trim() || undefined,
        textToImageModel: this.textToImageModel().trim() || undefined,
        imageToImageModel: this.imageToImageModel().trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.creating.set(false);
          this.created.emit(res.session.id);
        },
        error: (err) => {
          this.creating.set(false);
          this.error.set(err.error?.message || 'Failed to start session.');
        },
      });
  }
}
