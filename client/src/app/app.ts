import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminComponent } from './components/admin/admin.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AdminComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  title = 'kron-tavern';
  showAdmin = signal<boolean>(false);

  toggleAdmin() {
    this.showAdmin.update((v) => !v);
  }
}
