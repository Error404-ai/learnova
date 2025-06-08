const express = require('express');
const router = express.Router();
const {
  createClass,
  getAllClasses,
  joinClass,
  getClassById,
  toggleFavourite
} = require('../controllers/classcontroller');

router.post('/', createClass);
router.get('/all', getAllClasses);
router.post('/join', joinClass);
router.get('/:classId', getClassById);
router.post('/favourite', toggleFavourite);

module.exports = router;
