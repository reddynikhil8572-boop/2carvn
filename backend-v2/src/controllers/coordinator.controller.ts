import { Request, Response, NextFunction } from 'express';
import { getCoordinatorWorkspace } from '../services/coordinator.service';
import { successResponse } from '../utils/responseFormat';

export const getWorkspace = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const workspace = await getCoordinatorWorkspace(req.user!);
    res.status(200).json(successResponse(workspace, 'Coordinator workspace loaded'));
  } catch (error) {
    next(error);
  }
};
