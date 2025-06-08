const express = require('express');
const router = express.Router();
const {
  createClass,
  getAllClasses,
  joinClass,
  getClassById,
  toggleFavourite, addCoordinator,
  removeCoordinator
} = require('../controllers/classcontrollers');

router.post('/', createClass);
router.get('/all', getAllClasses);
router.post('/join', joinClass);
router.get('/:classId', getClassById);
router.post('/favourite', toggleFavourite);
router.post('/add-coordinator', addCoordinator);
router.post('/remove-coordinator', removeCoordinator);


module.exports = router;
