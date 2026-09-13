import { Router } from 'express';
import { createSchool, listSchools } from '../controllers/school.controller';
import { requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { createSchoolSchema } from '../validators/auth.validator';

const router = Router();

// Cross-tenant routes: the platform owner only. Handlers use asSuperAdmin(),
// which bypasses RLS, so this guard is the thing standing in front of it.
router.use(requireAuth, requireRole(['SUPER_ADMIN']));

router.post('/schools', validate(createSchoolSchema), createSchool);
router.get('/schools', listSchools);

export default router;
