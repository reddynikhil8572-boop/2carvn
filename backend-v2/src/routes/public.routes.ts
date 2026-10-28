import { Router } from 'express';
import { listPublishedCourses, submitEnquiry } from '../controllers/public.controller';
import { publicEnquiryLimiter } from '../middlewares/rateLimiter';
import { validate } from '../middlewares/validate';
import { publicEnquirySchema } from '../validators/public.validator';

const router = Router();

router.get('/courses', listPublishedCourses);
router.post('/enquiries', publicEnquiryLimiter, validate(publicEnquirySchema), submitEnquiry);

export default router;
