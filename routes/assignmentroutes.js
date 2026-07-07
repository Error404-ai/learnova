const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const { uploadAssignmentFiles } = require('../middlewares/uploadMiddleware');
const {
  createAssignment,
  getClassAssignments,
  updateAssignment,
  deleteAssignment,
  getAssignmentStats,
  submitAssignment,
  getAssignmentSubmissions,
  gradeSubmission,
  getAssignmentsBySubject,
} = require('../controllers/assignmentcontrollers');

router.use(protect);

// Teacher-only
router.post(
  '/',
  restrictTo('teacher'),
  uploadAssignmentFiles,
  (error, req, res, next) => {
    if (error) {
      console.error('File upload error:', error);
      return res.status(400).json({ success: false, message: error.message || 'File upload failed' });
    }
    next();
  },
  createAssignment
);
router.put('/:assignmentId', restrictTo('teacher'), updateAssignment);
router.delete('/:assignmentId', restrictTo('teacher'), deleteAssignment);
router.get('/:assignmentId/submissions', restrictTo('teacher'), getAssignmentSubmissions);
router.put('/:assignmentId/submissions/:submissionId/grade', restrictTo('teacher'), gradeSubmission);

// Student-only
router.post(
  '/:assignmentId/submit',
  restrictTo('student'),
  uploadAssignmentFiles,
  (error, req, res, next) => {
    if (error) {
      console.error('File upload error:', error);
      return res.status(400).json({ success: false, message: error.message || 'File upload failed' });
    }
    next();
  },
  submitAssignment
);

// Both
router.get('/class/:classId', getClassAssignments);
router.get('/subject/:subject', getAssignmentsBySubject);
router.get('/:assignmentId/stats', getAssignmentStats);

module.exports = router;