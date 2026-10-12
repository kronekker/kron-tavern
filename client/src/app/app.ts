import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminComponent } from './components/admin/admin.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AdminComponent, AuthModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  authService = inject(AuthService);
  title = 'kron-tavern';

  showAdmin = signal<boolean>(false);
  showAuth = signal<boolean>(false);

  toggleAdmin() {
    this.showAdmin.update((v) => !v);
  }

  toggleAuth() {
    this.showAuth.update((v) => !v);
  }
}
