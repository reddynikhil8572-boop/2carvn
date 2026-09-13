import { Request, Response, NextFunction } from 'express';
import * as service from '../services/certificate.service';
import { successResponse } from '../utils/responseFormat';

/** Requirements §10 — certificates. */

const idOf = (req: Request): string => String(req.params.id);
const serialOf = (req: Request): string => String(req.params.serial);

export const issueCertificate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const cert = await service.issueCertificate(req.user!, idOf(req), req.body.studentId);
    res.status(201).json(successResponse(cert, 'Certificate issued'));
  } catch (error) {
    next(error);
  }
};

export const listCertificates = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const certs = await service.listCertificates(req.user!, idOf(req));
    res.status(200).json(successResponse(certs, 'Certificates fetched'));
  } catch (error) {
    next(error);
  }
};

export const revokeCertificate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const cert = await service.revokeCertificate(req.user!, serialOf(req), req.body.reason);
    res.status(200).json(successResponse(cert, 'Certificate revoked'));
  } catch (error) {
    next(error);
  }
};

/**
 * PUBLIC — no session. Answers "is this credential real" and nothing else.
 *
 * A revoked certificate still resolves, and says so. Answering "no such
 * certificate" would be a lie that works in the holder's favour.
 */
export const verifyCertificate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const cert = await service.verifyCertificate(serialOf(req));
    res
      .status(200)
      .json(successResponse(cert, cert.valid ? 'Certificate is valid' : 'Certificate was revoked'));
  } catch (error) {
    next(error);
  }
};

/** PUBLIC — the PDF, rendered on demand. Revoked certificates 410. */
export const downloadCertificate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const serial = serialOf(req).replace(/\.pdf$/i, '');
    const pdf = await service.renderCertificate(serial);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="certificate-${serial}.pdf"`);
    res.status(200).send(pdf);
  } catch (error) {
    next(error);
  }
};
