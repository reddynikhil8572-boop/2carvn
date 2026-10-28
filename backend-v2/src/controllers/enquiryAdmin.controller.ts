import { Request, Response, NextFunction } from 'express';
import { asSuperAdmin } from '../db/tenantContext';
import { successResponse } from '../utils/responseFormat';
import type { updateEnquiryStatusSchema } from '../validators/public.validator';
import { z } from 'zod';

type UpdateStatusInput = z.infer<typeof updateEnquiryStatusSchema>;

const routeParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw Object.assign(new Error(`Invalid ${name} parameter`), { statusCode: 400 });
  }
  return value;
};

export const listEnquiries = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const enquiries = await asSuperAdmin((tx) =>
      tx.publicEnquiry.findMany({
        orderBy: { submittedAt: 'desc' },
        take: 100,
      })
    );
    res.status(200).json(successResponse(enquiries, 'Enquiries loaded'));
  } catch (error) {
    next(error);
  }
};

export const updateEnquiryStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = routeParam(req, 'id');
    const { status } = req.body as UpdateStatusInput;
    const enquiry = await asSuperAdmin(async (tx) => {
      const existing = await tx.publicEnquiry.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw Object.assign(new Error('Enquiry not found'), { statusCode: 404 });
      return tx.publicEnquiry.update({
        where: { id },
        data: { status },
      });
    });
    res.status(200).json(successResponse(enquiry, 'Enquiry status updated'));
  } catch (error) {
    next(error);
  }
};
