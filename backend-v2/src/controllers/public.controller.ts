import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { successResponse } from '../utils/responseFormat';
import type { PublicEnquiryInput } from '../validators/public.validator';

export const listPublishedCourses = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const courses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { title: 'asc' }],
      take: 50,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        subject: true,
        publishedAt: true,
      },
    });
    res.status(200).json(successResponse(courses, 'Published courses loaded'));
  } catch (error) {
    next(error);
  }
};

export const submitEnquiry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = req.body as PublicEnquiryInput;
    const enquiry = await prisma.publicEnquiry.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        organisation: input.organisation || null,
        kind: input.kind,
        message: input.message,
        status: 'NEW',
      },
      select: { id: true, submittedAt: true },
    });
    res.status(201).json(successResponse(enquiry, 'Thank you. Your enquiry has been received.'));
  } catch (error) {
    next(error);
  }
};
