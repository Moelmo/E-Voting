import express from 'express';
import rateLimit from 'express-rate-limit';
import { loginAdmin, loginStudent } from '../controllers/authController.js';
import { getPublicSettings, getActiveCandidates, castVote } from '../controllers/votingController.js';
import {
  verifySpoiler,
  getOverview,
  getRecap,
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  bulkDeleteStudents,
  getStudentTemplate,
  previewImportStudents,
  executeImportStudents,
  exportStudents,
  getStudentQRCards,
  getCandidates,
  createCandidate,
  updateCandidate,
  toggleCandidateActive,
  deleteCandidate,
  uploadFile,
  getSettings,
  updateSettings,
  updateLogos,
  changeAdminPassword,
  changeSpoilerPassword,
  resetVoting,
  getAuditLogs
} from '../controllers/adminController.js';
import { authenticateAdmin, authenticateStudent } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Rate limiter untuk perlindungan brute-force login
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 30, // max 30 permintaan per menit
  message: { success: false, message: 'Terlalu banyak percobaan masuk, silakan tunggu sesaat.' }
});

// --- PUBLIC & SISWA ---
router.post('/auth/student', loginLimiter, loginStudent);
router.post('/auth/admin', loginLimiter, loginAdmin);
router.get('/public/settings', getPublicSettings);

// Endpoint Voting Siswa
router.get('/candidates/active', authenticateStudent, getActiveCandidates);
router.post('/vote', authenticateStudent, castVote);

// --- ADMIN ROUTES (Protected) ---
router.use('/admin', authenticateAdmin);

// Spoiler Verification
router.post('/admin/spoiler/verify', verifySpoiler);

// Overview & Recap
router.get('/admin/overview', getOverview);
router.get('/admin/recap', getRecap);

// Students Management
router.get('/admin/students', getStudents);
router.post('/admin/students', createStudent);
router.put('/admin/students/:id', updateStudent);
router.delete('/admin/students/:id', deleteStudent);
router.post('/admin/students/bulk-delete', bulkDeleteStudents);

// Student Import/Export & QR
router.get('/admin/students/template', getStudentTemplate);
router.post('/admin/students/import/preview', upload.single('file'), previewImportStudents);
router.post('/admin/students/import', executeImportStudents);
router.get('/admin/students/export', exportStudents);
router.get('/admin/students/qr', getStudentQRCards);

// Candidates Management
router.get('/admin/candidates', getCandidates);
router.post('/admin/candidates', createCandidate);
router.put('/admin/candidates/:id', updateCandidate);
router.patch('/admin/candidates/:id/active', toggleCandidateActive);
router.delete('/admin/candidates/:id', deleteCandidate);
router.post('/admin/upload', upload.single('photo'), uploadFile);

// Settings & Security
router.get('/admin/settings', getSettings);
router.put('/admin/settings', updateSettings);
router.put('/admin/settings/logos', updateLogos);
router.put('/admin/password', changeAdminPassword);
router.put('/admin/spoiler-password', changeSpoilerPassword);
router.post('/admin/reset', resetVoting);
router.get('/admin/audit-logs', getAuditLogs);

export default router;
