const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const userController = require('../controllers/usercontrollers');
const auth = require('../middleware/auth');
const {
  createClass,
  getAllClasses,
  joinClassByCode,
  leaveClass,
  getClassById,
  getClassByCode,
  toggleFavourite,
  addCoordinator,
  removeCoordinator,
  deleteClass,
  getClassmates
} = require('../controllers/classcontrollers');

router.use(protect);

router.post('/', createClass);                        
router.get('/all', getAllClasses);                     
router.get('/:classId', getClassById);                 
router.delete('/:classId', deleteClass);           
router.get('/code/:classCode', getClassByCode);        
router.post('/join-by-code', joinClassByCode);       
router.post('/leave', leaveClass);                     
router.post('/favourite', toggleFavourite);          
router.post('/add-coordinator', addCoordinator);        
router.post('/remove-coordinator', removeCoordinator);  
router.get('/classmates/:classId', auth, getClassmates);
router.put('/user/message', auth, userController.updateMessage);
module.exports = router;