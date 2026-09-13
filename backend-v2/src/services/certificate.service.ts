import crypto from 'node:crypto';

import { withTenant, withoutTenant } from '../db/tenantContext';
import { findEditableCourse, isStaff } from './courseAccess';
import { config } from '../config/env';
import type { TokenPayload } from '../utils/jwt';
import { renderCertificatePdf, type CertificateView } from '../utils/certificatePdf';

/**
 * Requirements §10 — certificates.
 *
 * Issue is manual, by staff. Auto-issue on completion is the more interesting
 * behaviour but it needs the Phase 3 progress tables to mean anything: without
 * them "completed the course" is not a fact the system holds. Recorded as the
 * remaining open question rather than approximated.
 */

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const conflict = (m: string) => Object.assign(new Error(m), { statusCode: 409 });
const badRequest = (m: string) => Object.assign(new Error(m), { statusCode: 400 });

/**
 * Crockford-ish alphabet: no I, L, O or U, so a serial read off a printed
 * certificate and typed into the verification page does not fail on an
 * ambiguous character. Same reasoning as the 2FA recovery codes.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

/**
 * ~60 bits from a CSPRNG. Random rather than sequential because verification is
 * unauthenticated: a sequential serial would let anyone walk a school's entire
 * list of graduates.
 */
const generateSerial = (): string => {
  const groups: string[] = [];
  for (let g = 0; g < 3; g += 1) {
    let group = '';
    for (let i = 0; i < 4; i += 1) {
      group += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return `EDU-${groups.join('-')}`;
};

const verifyUrlFor = (serial: string): string =>
  `${config.frontendUrl.replace(/\/+$/, '')}/verify/${serial}`;

/**
 * Issues a certificate.
 *
 * The holder must actually be reachable by the course — enrolled in a class the
 * course is assigned to. Without that check, "issue a certificate for this
 * course" would accept any user id in the school, which is precisely the
 * request an attacker with a teacher account would make.
 */
export const issueCertificate = async (
  user: TokenPayload,
  courseId: string,
  studentId: string
) =>
  withTenant(user.schoolId!, async (tx) => {
    const course = await findEditableCourse(tx, courseId, user);

    const student = await tx.user.findFirst({
      where: {
        id: studentId,
        role: 'STUDENT',
        enrollments: { some: { class: { courseAssignments: { some: { courseId } } } } },
      },
      select: { id: true, name: true },
    });
    if (!student) {
      throw badRequest('That student is not taking this course');
    }

    const live = await tx.certificate.findFirst({
      where: { courseId, studentId, revokedAt: null },
    });
    if (live) throw conflict('This student already holds a certificate for this course');

    const school = await tx.school.findUnique({
      where: { id: user.schoolId! },
      select: { name: true },
    });

    const certificate = await tx.certificate.create({
      data: {
        schoolId: user.schoolId!,
        courseId,
        studentId,
        serial: generateSerial(),
        // Denormalised deliberately: a credential records what was true when it
        // was awarded, so renaming the course later must not rewrite it.
        courseTitle: course.title,
        studentName: student.name,
        schoolName: school?.name ?? '',
        issuedBy: user.userId,
      },
    });

    await tx.auditLog.create({
      data: {
        schoolId: user.schoolId!,
        actorId: user.userId,
        action: 'CERTIFICATE_ISSUED',
        entity: 'Certificate',
        entityId: certificate.id,
        metadata: { serial: certificate.serial, courseId, studentId },
      },
    });

    return certificate;
  });

/**
 * Revokes a certificate. Not a delete: a verifier asking about a revoked
 * credential must be told it was revoked, not that it never existed.
 */
export const revokeCertificate = async (
  user: TokenPayload,
  serial: string,
  reason: string | undefined
) =>
  withTenant(user.schoolId!, async (tx) => {
    const certificate = await tx.certificate.findUnique({ where: { serial } });
    if (!certificate) throw notFound('Certificate not found');

    await findEditableCourse(tx, certificate.courseId, user);

    if (certificate.revokedAt) throw conflict('This certificate is already revoked');

    const updated = await tx.certificate.update({
      where: { serial },
      data: { revokedAt: new Date(), revokeReason: reason },
    });

    await tx.auditLog.create({
      data: {
        schoolId: user.schoolId!,
        actorId: user.userId,
        action: 'CERTIFICATE_REVOKED',
        entity: 'Certificate',
        entityId: certificate.id,
        metadata: { serial, reason: reason ?? null },
      },
    });

    return updated;
  });

/** A student's own certificates, or a course's whole list for staff. */
export const listCertificates = async (user: TokenPayload, courseId?: string) =>
  withTenant(user.schoolId!, (tx) =>
    tx.certificate.findMany({
      where: {
        ...(courseId ? { courseId } : {}),
        ...(isStaff(user.role) ? {} : { studentId: user.userId }),
      },
      orderBy: { issuedAt: 'desc' },
    })
  );

interface VerificationRow {
  serial: string;
  student_name: string;
  course_title: string;
  school_name: string;
  issued_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

/**
 * PUBLIC verification. No session, no tenant.
 *
 * This is the only route in the system that reads tenant data with no
 * authentication at all, so it cannot go through RLS — there is no
 * current_school to compare against and the rows are correctly invisible. It
 * uses the same escape hatch as login: a narrow SECURITY DEFINER function that
 * returns only the four facts a verifier needs plus revocation status.
 *
 * No ids, no email, no class, no roster. A verifier is answering "is this
 * credential real", not browsing a school.
 */
export const verifyCertificate = async (serial: string) => {
  const rows = await withoutTenant(
    (tx) =>
      tx.$queryRaw<VerificationRow[]>`SELECT * FROM app_certificate_verify(${serial})` as Promise<
        VerificationRow[]
      >
  );

  const row = rows[0];
  if (!row) throw notFound('No certificate with that serial');

  return {
    serial: row.serial,
    studentName: row.student_name,
    courseTitle: row.course_title,
    schoolName: row.school_name,
    issuedAt: row.issued_at,
    // Stated positively AND negatively so a client cannot mistake a missing
    // field for validity.
    valid: row.revoked_at === null,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
  };
};

/**
 * Renders the certificate PDF on demand.
 *
 * A revoked certificate does not render. Because nothing was ever written to
 * storage, revocation takes effect on the next request rather than requiring
 * a file somewhere to be found and deleted.
 */
export const renderCertificate = async (serial: string): Promise<Buffer> => {
  const cert = await verifyCertificate(serial);

  if (!cert.valid) {
    throw Object.assign(new Error('This certificate has been revoked'), { statusCode: 410 });
  }

  const view: CertificateView = {
    serial: cert.serial,
    studentName: cert.studentName,
    courseTitle: cert.courseTitle,
    schoolName: cert.schoolName,
    issuedAt: new Date(cert.issuedAt),
    verifyUrl: verifyUrlFor(cert.serial),
  };

  return renderCertificatePdf(view);
};


