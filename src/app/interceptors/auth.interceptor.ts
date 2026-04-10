import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = localStorage.getItem('accessToken');
  
  console.log(`[Interceptor] ${req.method} ${req.url}`);
  console.log(`[Interceptor] Token: ${token ? token.substring(0, 20) + '...' : 'NULL'}`);

  if (!token || token === 'null' || token === 'undefined') {
    console.log('[Interceptor] No valid token, sending without auth');
    return next(req).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error(`[Interceptor] Error ${error.status} on ${req.url}`);
        if (error.status === 403 || error.status === 401) {
          console.log('[Interceptor] Clearing storage and redirecting');
          localStorage.removeItem('accessToken');
          localStorage.removeItem('userId');
          localStorage.removeItem('role');
          router.navigate(['/']);
        }
        return throwError(() => error);
      })
    );
  }

  const authReq = req.clone({
    headers: req.headers.set('Authorization', `Bearer ${token}`)
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      console.error(`[Interceptor] Error ${error.status} on ${req.url}`);
      if (error.status === 403 || error.status === 401) {
        console.log('[Interceptor] Token invalid, clearing storage');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('userId');
        localStorage.removeItem('role');
        router.navigate(['/']);
      }
      return throwError(() => error);
    })
  );
};