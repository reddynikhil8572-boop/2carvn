import PDFDocument from 'pdfkit';
import qrcode from 'qrcode';

/**
 * Renders a certificate to a PDF buffer.
 *
 * Ported from the previous backend's utils/pdfGenerator.ts — the layout and
 * the QR code transfer directly. What does NOT transfer is the tail of that
 * function, which uploaded the result to Cloudinary and returned a URL.
 *
 * Here the document is rendered **on demand** and streamed. That sidesteps
 * object storage, which is out of scope, but it is also the better design:
 * revoking a certificate stops it rendering immediately, rather than leaving a
 * live file in a bucket that has to be chased down separately. When storage
 * arrives, caching this becomes an optimisation rather than a correctness
 * requirement.
 */
export interface CertificateView {
  serial: string;
  studentName: string;
  courseTitle: string;
  schoolName: string;
  issuedAt: Date;
  verifyUrl: string;
}

export const renderCertificatePdf = async (cert: CertificateView): Promise<Buffer> => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const { width, height } = doc.page;

  doc.rect(20, 20, width - 40, height - 40).lineWidth(3).strokeColor('#1f2937').stroke();

  doc.fillColor('#111827');
  doc.moveDown(2);
  doc.fontSize(30).text('Certificate of Achievement', { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(13).fillColor('#6b7280').text('This is to certify that', { align: 'center' });

  doc.moveDown(0.6);
  doc.fontSize(26).fillColor('#111827').text(cert.studentName, { align: 'center' });

  doc.moveDown(0.8);
  doc.fontSize(13).fillColor('#6b7280').text('has successfully completed', { align: 'center' });

  doc.moveDown(0.6);
  doc.fontSize(20).fillColor('#111827').text(cert.courseTitle, { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(12).fillColor('#374151').text(cert.schoolName, { align: 'center' });
  doc
    .fontSize(11)
    .fillColor('#6b7280')
    .text(`Issued ${cert.issuedAt.toISOString().slice(0, 10)}`, { align: 'center' });

  doc.moveDown(1);
  doc.fontSize(10).fillColor('#6b7280').text(`Certificate ID: ${cert.serial}`, { align: 'center' });

  // The QR points at the public verification page, which is the whole reason
  // this artefact is worth anything to a third party.
  const qrDataUrl = await qrcode.toDataURL(cert.verifyUrl, { margin: 1 });
  const qrBuffer = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  doc.image(qrBuffer, width - 150, height - 150, { width: 90 });

  doc
    .fontSize(8)
    .fillColor('#9ca3af')
    .text('Verify at', 50, height - 90, { width: width - 220, align: 'left' })
    .text(cert.verifyUrl, { width: width - 220, align: 'left' });

  doc.end();
  return done;
};
