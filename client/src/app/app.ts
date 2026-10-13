import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminComponent } from './components/admin/admin.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { ModelCatalogComponent } from './components/model-catalog/model-catalog.component';
import { CharactersComponent } from './components/characters/characters.component';
import { PersonasComponent } from './components/personas/personas.component';
import { ChatStageComponent } from './components/chat-stage/chat-stage.component';
import { SessionSetupModalComponent } from './components/session-setup-modal/session-setup-modal.component';
import { AuthService } from './services/auth.service';
import type { CharacterItem } from './services/characters.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    AdminComponent,
    AuthModalComponent,
    ModelCatalogComponent,
    CharactersComponent,
    PersonasComponent,
    ChatStageComponent,
    SessionSetupModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  authService = inject(AuthService);
  title = 'kron-tavern';

  // Navigation Modals
  showAdmin = signal<boolean>(false);
  showAuth = signal<boolean>(false);
  showModels = signal<boolean>(false);
  showCharacters = signal<boolean>(false);
  showPersonas = signal<boolean>(false);

  // Active Chat Session State
  activeSessionId = signal<string | null>(null);
  showSessionSetup = signal<boolean>(false);
  setupCharacter = signal<CharacterItem | null>(null);

  toggleAdmin() {
    this.showAdmin.update((v) => !v);
  }

  toggleAuth() {
    this.showAuth.update((v) => !v);
  }

  toggleModels() {
    this.showModels.update((v) => !v);
  }

  toggleCharacters() {
    this.showCharacters.update((v) => !v);
  }

  togglePersonas() {
    this.showPersonas.update((v) => !v);
  }

  onStartChat(character: CharacterItem) {
    this.showCharacters.set(false);
    if (!this.authService.isAuthenticated()) {
      this.showAuth.set(true);
      return;
    }
    this.setupCharacter.set(character);
    this.showSessionSetup.set(true);
  }

  onOpenSession(sessionId: string) {
    this.showSessionSetup.set(false);
    this.showCharacters.set(false);
    this.activeSessionId.set(sessionId);
  }

  onCloseStage() {
    this.activeSessionId.set(null);
  }

  onSwitchSession(sessionId: string) {
    this.activeSessionId.set(sessionId);
  }

  onRequestNewSession() {
    if (!this.authService.isAuthenticated()) {
      this.showAuth.set(true);
      return;
    }
    this.setupCharacter.set(null);
    this.showSessionSetup.set(true);
  }
}
