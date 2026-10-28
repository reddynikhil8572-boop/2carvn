import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { asSuperAdmin } from '../db/tenantContext';
import { hashPassword } from '../services/auth.service';
import { requestReset } from '../services/passwordReset.service';
import { successResponse } from '../utils/responseFormat';
import type {
  createCoordinatorSchema,
  createDivisionSchema,
  grantCoordinatorDivisionSchema,
  setSchoolDivisionSchema,
} from '../validators/division.validator';
import { z } from 'zod';

type CreateDivisionInput = z.infer<typeof createDivisionSchema>;
type CreateCoordinatorInput = z.infer<typeof createCoordinatorSchema>;
type GrantInput = z.infer<typeof grantCoordinatorDivisionSchema>;
type SetSchoolDivisionInput = z.infer<typeof setSchoolDivisionSchema>;

const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const getRouteParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw Object.assign(new Error(`Invalid ${name} parameter`), { statusCode: 400 });
  }
  return value;
};

export const listDivisions = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const divisions = await asSuperAdmin((tx) =>
      tx.division.findMany({
        orderBy: { name: 'asc' },
        include: {
          schools: {
            orderBy: { name: 'asc' },
            select: { id: true, name: true, schoolCode: true, city: true, isActive: true },
          },
          coordinators: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              createdAt: true,
              revokedAt: true,
              coordinator: { select: { id: true, name: true, email: true, status: true } },
              assignedBy: { select: { id: true, name: true } },
              revokedBy: { select: { id: true, name: true } },
            },
          },
        },
      })
    );
    res.status(200).json(successResponse(divisions, 'Divisions loaded'));
  } catch (error) {
    next(error);
  }
};

export const listCoordinators = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const coordinators = await asSuperAdmin((tx) =>
      tx.user.findMany({
        where: { role: 'COORDINATOR' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          schoolId: true,
          name: true,
          email: true,
          status: true,
          school: { select: { name: true, schoolCode: true } },
        },
      })
    );
    res.status(200).json(successResponse(coordinators, 'Coordinators loaded'));
  } catch (error) {
    next(error);
  }
};

export const createDivision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = req.body as CreateDivisionInput;
    const division = await asSuperAdmin((tx) =>
      tx.division.create({
        data: { code: input.code, name: input.name, region: input.region },
      })
    );
    res.status(201).json(successResponse(division, 'Division created'));
  } catch (error) {
    next(error);
  }
};

export const createCoordinator = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = req.body as CreateCoordinatorInput;
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));
    const result = await asSuperAdmin(async (tx) => {
      const school = await tx.school.findUnique({
        where: { id: input.schoolId },
        select: { id: true, schoolCode: true, isActive: true },
      });
      if (!school || !school.isActive) throw notFound('Active school not found');
      const existing = await tx.user.findUnique({
        where: { schoolId_email: { schoolId: school.id, email: input.email } },
        select: { id: true },
      });
      if (existing) throw conflict('An account with this email already exists in the school');
      const coordinator = await tx.user.create({
        data: {
          schoolId: school.id,
          email: input.email,
          name: input.name,
          passwordHash,
          role: 'COORDINATOR',
        },
        select: { id: true, name: true, email: true, role: true, status: true, schoolId: true },
      });
      return { coordinator, schoolCode: school.schoolCode };
    });

    await requestReset(result.schoolCode, result.coordinator.email);
    res.status(201).json(successResponse(result.coordinator, 'Coordinator created; password setup required'));
  } catch (error) {
    next(error);
  }
};

export const grantCoordinatorDivision = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { coordinatorId } = req.body as GrantInput;
    const divisionId = getRouteParam(req, 'id');
    const grant = await asSuperAdmin(async (tx) => {
      const division = await tx.division.findUnique({ where: { id: divisionId }, select: { id: true } });
      if (!division) throw notFound('Division not found');
      const coordinator = await tx.user.findUnique({
        where: { id: coordinatorId },
        select: { id: true, role: true, status: true },
      });
      if (!coordinator || coordinator.role !== 'COORDINATOR' || coordinator.status !== 'ACTIVE') {
        throw notFound('Active coordinator not found');
      }
      const existing = await tx.coordinatorDivision.findFirst({
        where: { coordinatorId, divisionId: division.id, revokedAt: null },
        select: { id: true },
      });
      if (existing) throw conflict('Coordinator already has access to this division');
      return tx.coordinatorDivision.create({
        data: {
          coordinatorId,
          divisionId: division.id,
          assignedById: req.user!.userId,
        },
        include: {
          coordinator: { select: { id: true, name: true, email: true } },
          division: { select: { id: true, code: true, name: true } },
        },
      });
    });
    res.status(201).json(successResponse(grant, 'Coordinator assigned to division'));
  } catch (error) {
    next(error);
  }
};

export const revokeCoordinatorDivision = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const divisionId = getRouteParam(req, 'id');
    const coordinatorId = getRouteParam(req, 'coordinatorId');
    const grant = await asSuperAdmin(async (tx) => {
      const activeGrant = await tx.coordinatorDivision.findFirst({
        where: { coordinatorId, divisionId, revokedAt: null },
        select: { id: true },
      });
      if (!activeGrant) throw notFound('Active division grant not found');
      return tx.coordinatorDivision.update({
        where: { id: activeGrant.id },
        data: { revokedAt: new Date(), revokedById: req.user!.userId },
      });
    });
    res.status(200).json(successResponse(grant, 'Coordinator access revoked'));
  } catch (error) {
    next(error);
  }
};

export const setSchoolDivision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { divisionId } = req.body as SetSchoolDivisionInput;
    const schoolId = getRouteParam(req, 'id');
    const school = await asSuperAdmin(async (tx) => {
      if (divisionId && !(await tx.division.findUnique({ where: { id: divisionId }, select: { id: true } }))) {
        throw notFound('Division not found');
      }
      const existing = await tx.school.findUnique({ where: { id: schoolId }, select: { id: true } });
      if (!existing) throw notFound('School not found');
      return tx.school.update({
        where: { id: existing.id },
        data: { divisionId },
        select: { id: true, name: true, schoolCode: true, divisionId: true },
      });
    });
    res.status(200).json(successResponse(school, 'School division updated'));
  } catch (error) {
    next(error);
  }
};
