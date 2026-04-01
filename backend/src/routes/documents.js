const express = require('express');
const router = express.Router();
const {
  upload,
  getDocuments,
  uploadDocument,
  deleteDocument,
  reingestDocument,
  getDocumentQuality,
  reExtractDocument,
  getExtractionHistory,
  compareExtractions,
} = require('../controllers/documentController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/project/:projectId', getDocuments);
router.post('/upload/:projectId', upload.single('document'), uploadDocument);
router.delete('/:id', deleteDocument);
router.post('/:id/reingest', reingestDocument);
router.get('/:id/quality', getDocumentQuality);
router.post('/:id/re-extract', reExtractDocument);
router.get('/:id/extraction-history', getExtractionHistory);
router.get('/:id/compare-extractions', compareExtractions);

module.exports = router;
