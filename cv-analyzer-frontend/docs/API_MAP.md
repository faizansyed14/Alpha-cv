# Frontend → Backend API Map

Source of truth: existing `src/lib/api.ts` + `src/lib/trackerApi.ts`. No invented endpoints.

## Client

- Base URL (browser): `window.location.origin` (Next rewrite → backend)
- Auth: `Authorization: Bearer <auth_token>`
- Timeout: 600000ms (config)

## Feature → Service → Endpoint

| Feature | Service | Endpoint | Method |
|---------|---------|----------|--------|
| Health | systemService | `/api/health` | GET |
| Upload CV | cvService | `/api/cv/upload-cv` | POST |
| List CVs | cvService | `/api/cv/cvs` | GET |
| Keyword search | cvService | `/api/cv/keyword-search` | GET |
| CV details | cvService | `/api/cv/:id` | GET |
| Delete CV | cvService | `/api/cv/:id` | DELETE |
| Download CV | cvService | `/api/cv/:id/download` | GET |
| CV notes | cvService | `/api/cv/:id/note` | GET/POST/DELETE |
| Upload JD | jdService | `/api/jd/upload-jd` | POST |
| List JDs | jdService | `/api/jd/jds` | GET |
| Match | matchingService | `/api/match` | POST |
| Match text | matchingService | `/api/match-text` | POST |
| Category match | matchingService | `/api/match/category-based` | POST |
| Auth login/OTP/captcha | authService | `/api/auth/*` | POST/GET |
| Admin users | adminService | `/api/admin/users` | CRUD |
| Careers admin | careersService | `/api/careers/admin/jobs*` | * |
| Public careers | careersService | `/api/careers/jobs/*` | GET/POST |
| Email | emailService | `/api/email/*` | GET/POST |
| Performance | systemService | `/api/performance/*` | GET |
| Tracker | trackerApi | `/api/tracker/*` | * |
| Notice | api | `/api/notice`, `/api/admin/notice` | GET/PUT/DELETE |
| Storage files | api | `/api/storage/files/:type/:id` | GET |

## Matching freeze

- `POST /api/match` payload: `MatchRequest` (unchanged)
- Progress stages driven by `appStore.runMatch` + careers store — UI only wraps, never invents stages
