import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Router } from '@angular/router';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  constructor(private http: HttpClient, private router: Router) {}

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

    this.http.post<{ accessToken: string; userId: number; email: string; role: string }>(
      'http://localhost:8080/api/auth/register',
      {
        name: this.name,
        email: this.email,
        password: this.password
      }
    ).subscribe({
      next: (response) => {
        localStorage.setItem('accessToken', response.accessToken);
        localStorage.setItem('userId', String(response.userId));
        localStorage.setItem('role', response.role);
        this.isLoading = false;
        this.router.navigate(['/map']);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Registration failed. Please try again.';
        this.isLoading = false;
      }
    });
  }
}