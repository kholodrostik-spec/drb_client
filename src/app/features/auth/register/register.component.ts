import { Component } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, CommonModule, HttpClientModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  name = '';
  password = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  constructor(private http: HttpClient) {}

  get passwordsMatch(): boolean {
    return this.password === this.confirmPassword && this.password.length > 0;
  }

  get formValid(): boolean {
    return this.name.trim().length > 0 && this.passwordsMatch;
  }

  onSubmit(): void {
    if (!this.formValid) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.http.post('https://your-api.com/api/register', {
      name: this.name,
      password: this.password
    }).subscribe({
      next: () => {
        this.successMessage = 'Реєстрацію успішно завершено!';
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Помилка сервера.';
        this.isLoading = false;
      }
    });
  }
}