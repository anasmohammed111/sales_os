import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PlatformService } from '../services/platform.service';

/** The super admin console needs a valid console sign-in. */
export const platformGuard: CanActivateFn = () => {
  const platform = inject(PlatformService);
  if (platform.isSignedIn()) return true;
  platform.signOut(false);
  return inject(Router).createUrlTree(['/platform/login']);
};
