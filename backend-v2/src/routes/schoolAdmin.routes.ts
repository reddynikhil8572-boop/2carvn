import { Router } from 'express';
import { createUser, listUsers } from '../controllers/school.controller';
import { eraseUserData, exportUserData } from '../controllers/privacy.controller';
import { requireAuth, requireRole, requireTenant } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { createUserSchema } from '../validators/auth.validator';

const router = Router();

// Tenant-scoped. requireTenant guarantees schoolId is present; RLS guarantees
// the queries cannot reach beyond it.
router.use(requireAuth, requireRole(['SCHOOL_ADMIN']), requireTenant);

router.post('/users', validate(createUserSchema), createUser);
router.get('/users', listUsers);

// Subject access and erasure (GDPR). Both are school-admin only and both are
// audit-logged — see controllers/privacy.controller.ts. The erasure endpoint
// anonymises rather than deleting; `docs/DATA_RETENTION.md` §3 explains why a
// cascade would destroy the class's records along with the pupil's.
router.get('/users/:id/export', exportUserData);
router.delete('/users/:id', eraseUserData);

export default router;
