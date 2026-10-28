import { Router } from 'express';
import { createSchool, listSchools } from '../controllers/school.controller';
import { requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { createSchoolSchema } from '../validators/auth.validator';
import * as allocationCtrl from '../controllers/teacherAllocation.controller';
import {
  schoolIdQuerySchema,
  teacherIdParamsSchema,
  timetableSlotParamsSchema,
} from '../validators/teacherAllocationParams.validator';
import {
  availabilitySchema,
  createTeacherAllocationSchema,
  createTimetableSlotSchema,
  decideAllocationRequestSchema,
  updateTeacherAllocationSchema,
} from '../validators/teacherAllocation.validator';
import { idParamSchema } from '../validators/course.validator';
import { validateParams, validateQuery } from '../middlewares/validate';
import * as divisionCtrl from '../controllers/division.controller';
import * as enquiryAdminCtrl from '../controllers/enquiryAdmin.controller';
import {
  coordinatorDivisionParamsSchema,
  createCoordinatorSchema,
  createDivisionSchema,
  grantCoordinatorDivisionSchema,
  setSchoolDivisionSchema,
} from '../validators/division.validator';
import { updateEnquiryStatusSchema } from '../validators/public.validator';

const router = Router();

// Cross-tenant routes: the platform owner only. Handlers use asSuperAdmin(),
// which bypasses RLS, so this guard is the thing standing in front of it.
router.use(requireAuth, requireRole(['ADMIN']));

router.post('/schools', validate(createSchoolSchema), createSchool);
router.get('/schools', listSchools);
router.get('/enquiries', enquiryAdminCtrl.listEnquiries);
router.patch(
  '/enquiries/:id',
  validateParams(idParamSchema),
  validate(updateEnquiryStatusSchema),
  enquiryAdminCtrl.updateEnquiryStatus,
);
router.get('/divisions', divisionCtrl.listDivisions);
router.get('/coordinators', divisionCtrl.listCoordinators);
router.post('/divisions', validate(createDivisionSchema), divisionCtrl.createDivision);
router.post('/coordinators', validate(createCoordinatorSchema), divisionCtrl.createCoordinator);
router.post(
  '/divisions/:id/coordinators',
  validateParams(idParamSchema),
  validate(grantCoordinatorDivisionSchema),
  divisionCtrl.grantCoordinatorDivision,
);
router.delete(
  '/divisions/:id/coordinators/:coordinatorId',
  validateParams(coordinatorDivisionParamsSchema),
  divisionCtrl.revokeCoordinatorDivision,
);
router.patch(
  '/schools/:id/division',
  validateParams(idParamSchema),
  validate(setSchoolDivisionSchema),
  divisionCtrl.setSchoolDivision,
);
router.get('/teacher-allocations', validateQuery(schoolIdQuerySchema), allocationCtrl.getWorkspace);
router.post(
  '/teacher-allocations',
  validateQuery(schoolIdQuerySchema),
  validate(createTeacherAllocationSchema),
  allocationCtrl.createAllocation,
);
router.patch(
  '/teacher-allocations/:id',
  validateQuery(schoolIdQuerySchema),
  validateParams(idParamSchema),
  validate(updateTeacherAllocationSchema),
  allocationCtrl.updateAllocation,
);
router.post(
  '/teacher-allocations/:id/timetable',
  validateQuery(schoolIdQuerySchema),
  validateParams(idParamSchema),
  validate(createTimetableSlotSchema),
  allocationCtrl.addTimetableSlot,
);
router.delete(
  '/teacher-allocations/:id/timetable/:slotId',
  validateQuery(schoolIdQuerySchema),
  validateParams(timetableSlotParamsSchema),
  allocationCtrl.removeTimetableSlot,
);
router.get(
  '/teacher-allocations/:id/history',
  validateQuery(schoolIdQuerySchema),
  validateParams(idParamSchema),
  allocationCtrl.getHistory,
);
router.post(
  '/teacher-allocation-requests/:id/decision',
  validateParams(idParamSchema),
  validate(decideAllocationRequestSchema),
  allocationCtrl.decideRequest,
);
router.put(
  '/teacher-allocations/teachers/:teacherId/availability',
  validateQuery(schoolIdQuerySchema),
  validateParams(teacherIdParamsSchema),
  validate(availabilitySchema),
  allocationCtrl.setTeacherAvailability,
);

export default router;
