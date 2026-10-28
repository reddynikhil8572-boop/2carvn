import { Router } from 'express';
import { getWorkspace } from '../controllers/coordinator.controller';
import { requireAuth, requireRole } from '../middlewares/auth';

const router = Router();

router.use(requireAuth, requireRole(['COORDINATOR']));
router.get('/divisions', getWorkspace);

export default router;
