import { Router } from 'express';
import authRoutes from './auth.routes';
import superAdminRoutes from './superAdmin.routes';
import schoolAdminRoutes from './schoolAdmin.routes';
import classRoutes from './class.routes';
import courseRoutes, {
  attemptRouter,
  chapterRouter,
  lessonItemRouter,
  lessonRouter,
  moduleRouter,
  submissionRouter,
} from './course.routes';
import {
  certificateAdminRouter,
  publicCertificateRouter,
} from './certificate.routes';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: '2carvn API v1',
    data: { version: 'v1', phase: 2 },
  });
});

router.use('/auth', authRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/school-admin', schoolAdminRoutes);
// §6 course hierarchy. Levels below Course are addressed by their own ids
// rather than nested under /courses/:id, each on its own prefix — mounting a
// router carrying auth middleware at '/' would apply it to unmatched paths and
// turn the JSON 404 below into a 401.
router.use('/classes', classRoutes);
router.use('/courses', courseRoutes);
router.use('/modules', moduleRouter);
router.use('/chapters', chapterRouter);
router.use('/lessons', lessonRouter);
router.use('/items', lessonItemRouter);
router.use('/attempts', attemptRouter);
router.use('/submissions', submissionRouter);
// §10 — the public verification pair carries NO auth middleware by design; the
// admin router beside it does. Kept as separate routers so an authenticated
// route cannot be added next to the public ones by accident.
router.use('/certificates', publicCertificateRouter);
router.use('/certificates', certificateAdminRouter);

export default router;
