import { Router } from 'express';
import * as allocationCtrl from '../controllers/teacherAllocation.controller';
import { requireAuth, requireRole, requireTenant } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { availabilitySchema } from '../validators/teacherAllocation.validator';

const router = Router();
const teacherOnly = [requireAuth, requireRole(['TEACHER']), requireTenant] as const;

router.get('/me', ...teacherOnly, allocationCtrl.getMyAllocations);
router.put('/me/availability', ...teacherOnly, validate(availabilitySchema), allocationCtrl.setMyAvailability);

export default router;
