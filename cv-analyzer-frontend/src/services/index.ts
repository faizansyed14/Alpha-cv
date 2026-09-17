/**
 * Domain-grouped service layer.
 *
 * These are thin groupings over the existing `api` client (src/lib/api.ts) —
 * no duplicated logic. Pages can import a single domain:
 *
 *   import { cvService } from '@/services';
 *   const { cvs } = await cvService.list();
 */
export { authService } from './authService';
export { cvService } from './cvService';
export { jdService } from './jdService';
export { matchingService } from './matchingService';
export { careersService } from './careersService';
export { adminService } from './adminService';
export { systemService } from './systemService';
export { emailService } from './emailService';
