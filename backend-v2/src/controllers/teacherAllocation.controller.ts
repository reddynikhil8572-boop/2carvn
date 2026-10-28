import { Request, Response, NextFunction } from 'express';
import * as service from '../services/teacherAllocation.service';
import { successResponse } from '../utils/responseFormat';

const idOf = (req: Request): string => String(req.params.id);
const schoolIdOf = (req: Request): string => String(req.validatedQuery?.schoolId);

const handler =
  (
    fn: (req: Request) => Promise<unknown>,
    status: number,
    message: string,
  ) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(status).json(successResponse(await fn(req), message));
    } catch (error) {
      next(error);
    }
  };

export const getWorkspace = handler(
  (req) => service.listWorkspace(req.user!, schoolIdOf(req)),
  200,
  'Teacher allocation workspace fetched',
);

export const getOwnWorkspace = handler(
  (req) => service.listWorkspace(req.user!, req.user!.schoolId!),
  200,
  'Teacher allocation workspace fetched',
);

export const getMyAllocations = handler(
  (req) => service.listMyAllocations(req.user!),
  200,
  'Your teacher allocations fetched',
);

export const createAllocation = handler(
  (req) => service.createAllocationAsAdmin(req.user!, schoolIdOf(req), req.body),
  201,
  'Teacher allocated',
);

export const updateAllocation = handler(
  (req) => service.updateAllocationAsAdmin(req.user!, schoolIdOf(req), idOf(req), req.body),
  200,
  'Teacher allocation updated',
);

export const submitRequest = handler(
  (req) => service.submitAllocationRequest(req.user!, req.body),
  201,
  'Teacher allocation request submitted',
);

export const decideRequest = handler(
  (req) => service.decideAllocationRequest(req.user!, idOf(req), req.body),
  200,
  'Teacher allocation request decided',
);

export const addTimetableSlot = handler(
  (req) => service.addTimetableSlot(req.user!, schoolIdOf(req), idOf(req), req.body),
  201,
  'Timetable slot added',
);

export const removeTimetableSlot = handler(
  (req) => service.removeTimetableSlot(req.user!, schoolIdOf(req), idOf(req), String(req.params.slotId)),
  200,
  'Timetable slot removed',
);

export const setMyAvailability = handler(
  (req) => service.setTeacherAvailability(req.user!, req.user!.schoolId!, req.user!.userId, req.body),
  200,
  'Teacher availability updated',
);

export const setTeacherAvailability = handler(
  (req) => service.setTeacherAvailability(req.user!, schoolIdOf(req), String(req.params.teacherId), req.body),
  200,
  'Teacher availability updated',
);

export const getHistory = handler(
  (req) => service.listAllocationHistory(req.user!, schoolIdOf(req), idOf(req)),
  200,
  'Teacher allocation history fetched',
);
