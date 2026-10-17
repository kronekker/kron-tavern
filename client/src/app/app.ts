import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminComponent } from './components/admin/admin.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { ModelCatalogComponent } from './components/model-catalog/model-catalog.component';
import { CharactersComponent } from './components/characters/characters.component';
import { PersonasComponent } from './components/personas/personas.component';
import { ChatStageComponent } from './components/chat-stage/chat-stage.component';
import { SessionSetupModalComponent } from './components/session-setup-modal/session-setup-modal.component';
import { SessionsModalComponent } from './components/sessions-modal/sessions-modal.component';
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
    SessionsModalComponent,
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
  showSessions = signal<boolean>(false);

  // Active Chat Session State
  activeSessionId = signal<string | null>(null);
  showSessionSetup = signal<boolean>(false);
  setupCharacter = signal<CharacterItem | null>(null);

  // Collapsible Top Navbar State
  isNavbarCollapsed = signal<boolean>(false);

  toggleNavbar() {
    this.isNavbarCollapsed.update((v) => !v);
  }

  setNavbarCollapsed(collapsed: boolean) {
    this.isNavbarCollapsed.set(collapsed);
  }

  private checkAutoCollapseForMobile() {
    if (typeof window !== 'undefined' && window.innerWidth <= 820) {
      this.isNavbarCollapsed.set(true);
    }
  }

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

  toggleSessions() {
    if (!this.authService.isAuthenticated()) {
      this.showAuth.set(true);
      return;
    }
    this.showSessions.update((v) => !v);
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
    this.showSessions.set(false);
    this.activeSessionId.set(sessionId);
    this.checkAutoCollapseForMobile();
  }

  onSessionDeleted(deletedId: string) {
    if (this.activeSessionId() === deletedId) {
      this.activeSessionId.set(null);
    }
  }

  onCloseStage() {
    this.activeSessionId.set(null);
    this.isNavbarCollapsed.set(false);
  }

  onSwitchSession(sessionId: string) {
    this.activeSessionId.set(sessionId);
    this.checkAutoCollapseForMobile();
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
