import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminComponent } from './components/admin/admin.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { ModelCatalogComponent } from './components/model-catalog/model-catalog.component';
import { CharactersComponent } from './components/characters/characters.component';
import { PersonasComponent } from './components/personas/personas.component';
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
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  authService = inject(AuthService);
  title = 'kron-tavern';

  showAdmin = signal<boolean>(false);
  showAuth = signal<boolean>(false);
  showModels = signal<boolean>(false);
  showCharacters = signal<boolean>(false);
  showPersonas = signal<boolean>(false);

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
    console.log('Start chat with character:', character.name);
  }
}
