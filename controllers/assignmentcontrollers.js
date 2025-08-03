const Assignment = require('../models/assignment');
const Class = require('../models/Class');
const mongoose = require('mongoose');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);
};

const checkClassPermission = async (classId, userId) => {
  const classObj = await Class.findById(classId);
  if (!classObj) {
    return { hasPermission: false, error: 'Class not found', classObj: null };
  }

  const isCreator = classObj.createdBy.toString() === userId.toString();
  const isCoordinator = classObj.coordinators.some(coord => coord.toString() === userId.toString());
  const isStudent = classObj.students.some(student => student.toString() === userId.toString());
  
  return { 
    hasPermission: isCreator || isCoordinator || isStudent, 
    error: null, 
    classObj,
    isCreator,
    isCoordinator,
    isStudent
  };
};

exports.getClassAssignments = async (req, res) => {
  try {
    const { classId } = req.params;
    const { status, category, sortBy, sortOrder, page, limit } = req.query;
    const userId = req.user?.id;

    console.log('Get class assignments:', { classId, userId, query: req.query });

    if (!classId) {
      return res.status(400).json({
        success: false,
        message: 'Class ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Validate ObjectId format
    if (!isValidObjectId(classId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid class ID format'
      });
    }

    // Check class access and get class details
    const { hasPermission, error, classObj, isCreator, isCoordinator, isStudent } = 
      await checkClassPermission(classId, userId);

    if (!hasPermission) {
      return res.status(error === 'Class not found' ? 404 : 403).json({
        success: false,
        message: error || 'Access denied to this class'
      });
    }

    // Build query - CRITICAL: Only get assignments for THIS specific class
    const query = { 
      classId: new mongoose.Types.ObjectId(classId) // Ensure exact match
    };
    
    // Additional filters
    if (status) {
      const validStatuses = ['active', 'inactive', 'draft'];
      if (validStatuses.includes(status)) {
        query.status = status;
      }
    }
    
    if (category) {
      const validCategories = ['assignment', 'quiz', 'project', 'exam', 'homework'];
      if (validCategories.includes(category)) {
        query.category = category;
      }
    }

    // Pagination
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNumber - 1) * limitNumber;

    // Sorting
    let sortOptions = { createdAt: -1 }; // default sort
    if (sortBy) {
      const validSortFields = ['createdAt', 'dueDate', 'title', 'maxMarks'];
      if (validSortFields.includes(sortBy)) {
        const order = sortOrder === 'asc' ? 1 : -1;
        sortOptions = { [sortBy]: order };
      }
    }

    // Get total count for pagination
    const totalCount = await Assignment.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limitNumber);

    // Fetch assignments with explicit class verification
    const assignments = await Assignment.find(query)
      .populate('createdBy', 'name email profilePicture')
      .populate({
        path: 'classId',
        select: 'className subject createdBy',
        match: { _id: new mongoose.Types.ObjectId(classId) } // Double-check class match
      })
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNumber)
      .lean();

    // Filter out any assignments where classId didn't match (extra safety)
    const validAssignments = assignments.filter(assignment => 
      assignment.classId && assignment.classId._id.toString() === classId
    );

    // Process assignments with user-specific data
    const assignmentsWithStatus = validAssignments.map(assignment => {
      const userSubmission = assignment.submissions?.find(
        sub => sub.studentId?.toString() === userId
      );

      return {
        ...assignment,
        hasSubmitted: !!userSubmission,
        userSubmission: isStudent ? userSubmission : undefined,
        submissionsCount: assignment.submissions?.length || 0,
        isOverdue: assignment.dueDate && new Date() > new Date(assignment.dueDate),
        isCreator: assignment.createdBy._id.toString() === userId,
        canEdit: isCreator || isCoordinator || assignment.createdBy._id.toString() === userId,
        canDelete: assignment.createdBy._id.toString() === userId,
        // Add subject info for verification
        subject: assignment.classId.subject,
        className: assignment.classId.className
      };
    });

    res.status(200).json({
      success: true,
      assignments: assignmentsWithStatus,
      pagination: {
        currentPage: pageNumber,
        totalPages,
        totalCount: validAssignments.length, // Use filtered count
        hasNext: pageNumber < totalPages,
        hasPrev: pageNumber > 1,
        limit: limitNumber
      },
      classInfo: {
        _id: classObj._id,
        className: classObj.className,
        subject: classObj.subject
      },
      userRole: isCreator ? 'creator' : isCoordinator ? 'coordinator' : 'student'
    });

  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignments',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

// Enhanced createAssignment with better subject association
exports.createAssignment = async (req, res) => {
  try {
    console.log('Create assignment request:', { body: req.body, user: req.user?.id });

    const {
      title,
      description,
      classId,
      dueDate,
      maxMarks,
      attachments,
      instructions,
      allowLateSubmission,
      category
    } = req.body;

    // Validation
    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required and cannot be empty'
      });
    }

    if (!description?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Description is required and cannot be empty'
      });
    }

    if (!classId?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Class ID is required'
      });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - user not found in request'
      });
    }

    const userId = req.user.id;
    if (!isValidObjectId(classId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid class ID format'
      });
    }

    // Get class with full details including subject
    const classObj = await Class.findById(classId)
      .populate('createdBy', 'name email')
      .select('className subject createdBy coordinators students');

    if (!classObj) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Permission check
    const isCreator = classObj.createdBy._id.toString() === userId.toString();
    const isCoordinator = classObj.coordinators.some(coord => coord.toString() === userId.toString());

    if (!isCreator && !isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Only class creator or coordinators can create assignments'
      });
    }

    // Validate due date
    if (dueDate) {
      const dueDateObj = new Date(dueDate);
      if (isNaN(dueDateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid due date format'
        });
      }
      if (dueDateObj <= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Due date must be in the future'
        });
      }
    }

    // Validate marks
    if (maxMarks !== undefined) {
      const marks = Number(maxMarks);
      if (isNaN(marks) || marks <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Maximum marks must be a positive number'
        });
      }
    }

    // Validate category
    const validCategories = ['assignment', 'quiz', 'project', 'exam', 'homework'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Must be one of: ' + validCategories.join(', ')
      });
    }

    // Create assignment with explicit class binding
    const assignmentData = {
      title: title.trim(),
      description: description.trim(),
      classId: new mongoose.Types.ObjectId(classId), // Explicit binding to class
      createdBy: new mongoose.Types.ObjectId(userId),
      dueDate: dueDate ? new Date(dueDate) : null,
      maxMarks: maxMarks ? Number(maxMarks) : 100,
      attachments: Array.isArray(attachments) ? attachments : [],
      instructions: instructions ? instructions.trim() : '',
      allowLateSubmission: Boolean(allowLateSubmission),
      category: category || 'assignment',
      status: 'active',
      submissions: []
    };

    const newAssignment = new Assignment(assignmentData);
    await newAssignment.save();

    // Populate the assignment with class info
    await newAssignment.populate([
      { path: 'createdBy', select: 'name email profilePicture' },
      { path: 'classId', select: 'className subject' }
    ]);

    // Verify the assignment is properly linked to the class
    if (!newAssignment.classId || newAssignment.classId._id.toString() !== classId) {
      console.error('Assignment-Class linking failed:', {
        assignmentClassId: newAssignment.classId?._id,
        expectedClassId: classId
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to properly link assignment to class'
      });
    }

    const responseData = {
      _id: newAssignment._id,
      title: newAssignment.title,
      description: newAssignment.description,
      classId: newAssignment.classId,
      createdBy: newAssignment.createdBy,
      dueDate: newAssignment.dueDate,
      maxMarks: newAssignment.maxMarks,
      attachments: newAssignment.attachments,
      instructions: newAssignment.instructions,
      allowLateSubmission: newAssignment.allowLateSubmission,
      category: newAssignment.category,
      status: newAssignment.status,
      submissionsCount: 0,
      createdAt: newAssignment.createdAt,
      updatedAt: newAssignment.updatedAt
    };

    res.status(201).json({
      success: true,
      message: `Assignment created successfully for ${classObj.subject} - ${classObj.className}`,
      assignment: responseData,
      classInfo: {
        className: classObj.className,
        subject: classObj.subject
      }
    });

  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create assignment',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

// Helper function to get assignments by subject
exports.getAssignmentsBySubject = async (req, res) => {
  try {
    const { subject } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!subject?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required'
      });
    }

    // Find all classes for this subject that user has access to
    const userClasses = await Class.find({
      subject: subject.trim(),
      $or: [
        { createdBy: userId },
        { coordinators: userId },
        { students: userId }
      ]
    }).select('_id className');

    if (!userClasses.length) {
      return res.status(404).json({
        success: false,
        message: 'No classes found for this subject or access denied'
      });
    }

    const classIds = userClasses.map(cls => cls._id);

    // Get all assignments for these classes
    const assignments = await Assignment.find({
      classId: { $in: classIds },
      status: 'active'
    })
      .populate('createdBy', 'name email')
      .populate('classId', 'className subject')
      .sort({ createdAt: -1 })
      .lean();

    // Group assignments by class
    const assignmentsByClass = userClasses.map(cls => ({
      classId: cls._id,
      className: cls.className,
      assignments: assignments.filter(assignment => 
        assignment.classId._id.toString() === cls._id.toString()
      )
    }));

    res.status(200).json({
      success: true,
      subject,
      classes: assignmentsByClass,
      totalAssignments: assignments.length
    });

  } catch (err) {
    console.error('Error fetching assignments by subject:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignments by subject',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};


exports.updateAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;
    const updateData = { ...req.body };

    console.log('Update assignment:', { assignmentId, userId, updateData });

    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Validate ObjectId format
    if (!isValidObjectId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Assignment ID format'
      });
    }

    // Fetch assignment with class data
    const assignment = await Assignment.findById(assignmentId)
      .populate('classId', 'createdBy coordinators className');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check permissions
    const isAssignmentCreator = assignment.createdBy.toString() === userId;
    const isClassCreator = assignment.classId.createdBy.toString() === userId;
    const isCoordinator = assignment.classId.coordinators.some(coord => coord.toString() === userId);

    if (!isAssignmentCreator && !isClassCreator && !isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Only assignment creator, class creator, or coordinators can update assignments'
      });
    }

    // Validate update data
    if (updateData.title !== undefined) {
      if (!updateData.title.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Title cannot be empty'
        });
      }
      updateData.title = updateData.title.trim();
    }

    if (updateData.description !== undefined) {
      if (!updateData.description.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Description cannot be empty'
        });
      }
      updateData.description = updateData.description.trim();
    }

    if (updateData.dueDate !== undefined) {
      if (updateData.dueDate) {
        const dueDateObj = new Date(updateData.dueDate);
        if (isNaN(dueDateObj.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid due date format'
          });
        }
        if (dueDateObj <= new Date()) {
          return res.status(400).json({
            success: false,
            message: 'Due date must be in the future'
          });
        }
        updateData.dueDate = dueDateObj;
      } else {
        updateData.dueDate = null;
      }
    }

    if (updateData.maxMarks !== undefined) {
      const marks = Number(updateData.maxMarks);
      if (isNaN(marks) || marks <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Maximum marks must be a positive number'
        });
      }
      updateData.maxMarks = marks;
    }

    if (updateData.category !== undefined) {
      const validCategories = ['assignment', 'quiz', 'project', 'exam', 'homework'];
      if (!validCategories.includes(updateData.category)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category. Must be one of: ' + validCategories.join(', ')
        });
      }
    }

    if (updateData.status !== undefined) {
      const validStatuses = ['active', 'inactive', 'draft'];
      if (!validStatuses.includes(updateData.status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
        });
      }
    }

    if (updateData.instructions !== undefined) {
      updateData.instructions = updateData.instructions.trim();
    }

    // Remove fields that shouldn't be updated
    delete updateData._id;
    delete updateData.createdBy;
    delete updateData.classId;
    delete updateData.submissions;
    delete updateData.createdAt;

    // Add updatedAt timestamp
    updateData.updatedAt = new Date();

    // Update assignment
    const updatedAssignment = await Assignment.findByIdAndUpdate(
      assignmentId,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email profilePicture')
      .populate('classId', 'className subject');

    res.status(200).json({
      success: true,
      message: 'Assignment updated successfully',
      assignment: updatedAssignment
    });

  } catch (err) {
    console.error('Error updating assignment:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update assignment',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;

    console.log('Delete assignment:', { assignmentId, userId });

    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Validate ObjectId format
    if (!isValidObjectId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Assignment ID format'
      });
    }

    // Fetch assignment
    const assignment = await Assignment.findById(assignmentId)
      .populate('classId', 'className');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check permissions - only assignment creator can delete
    if (assignment.createdBy.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only assignment creator can delete the assignment'
      });
    }

    const hasSubmissions = assignment.submissions && assignment.submissions.length > 0;
    
    if (hasSubmissions) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete assignment with existing submissions. Consider marking it as inactive instead.',
        submissionsCount: assignment.submissions.length
      });
    }

    await Assignment.findByIdAndDelete(assignmentId);

    res.status(200).json({
      success: true,
      message: 'Assignment deleted successfully',
      deletedAssignment: {
        _id: assignment._id,
        title: assignment.title,
        className: assignment.classId.className
      }
    });

  } catch (err) {
    console.error('Error deleting assignment:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

exports.getAssignmentStats = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!isValidObjectId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Assignment ID format'
      });
    }

    const assignment = await Assignment.findById(assignmentId)
      .populate('classId', 'createdBy coordinators students className');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check permissions
    const isCreator = assignment.createdBy.toString() === userId;
    const isClassCreator = assignment.classId.createdBy.toString() === userId;
    const isCoordinator = assignment.classId.coordinators.some(coord => coord.toString() === userId);

    if (!isCreator && !isClassCreator && !isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const totalStudents = assignment.classId.students.length;
    const totalSubmissions = assignment.submissions?.length || 0;
    const gradedSubmissions = assignment.submissions?.filter(sub => sub.marks !== undefined).length || 0;
    const lateSubmissions = assignment.submissions?.filter(sub => 
      assignment.dueDate && new Date(sub.submittedAt) > new Date(assignment.dueDate)
    ).length || 0;

    const stats = {
      totalStudents,
      totalSubmissions,
      submissionRate: totalStudents > 0 ? ((totalSubmissions / totalStudents) * 100).toFixed(2) : 0,
      gradedSubmissions,
      pendingGrading: totalSubmissions - gradedSubmissions,
      lateSubmissions,
      isOverdue: assignment.dueDate && new Date() > new Date(assignment.dueDate),
      averageMarks: gradedSubmissions > 0 ? 
        (assignment.submissions
          .filter(sub => sub.marks !== undefined)
          .reduce((sum, sub) => sum + sub.marks, 0) / gradedSubmissions
        ).toFixed(2) : null
    };

    res.status(200).json({
      success: true,
      stats,
      assignment: {
        _id: assignment._id,
        title: assignment.title,
        maxMarks: assignment.maxMarks,
        dueDate: assignment.dueDate,
        className: assignment.classId.className
      }
    });

  } catch (err) {
    console.error('Error fetching assignment stats:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment statistics',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};
// Submit Assignment (for students)
exports.submitAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { content, attachments } = req.body;
    const userId = req.user?.id;

    console.log('Submit assignment:', { assignmentId, userId, content, attachments });

    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    if (!isValidObjectId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Assignment ID format'
      });
    }

    if (!content?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Submission content is required'
      });
    }
    const assignment = await Assignment.findById(assignmentId)
      .populate('classId', 'students className');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    const isStudent = assignment.classId.students.some(
      student => student.toString() === userId
    );

    if (!isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Only enrolled students can submit assignments'
      });
    }
    if (assignment.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Assignment is not active for submissions'
      });
    }
    const now = new Date();
    const isOverdue = assignment.dueDate && now > new Date(assignment.dueDate);
    
    if (isOverdue && !assignment.allowLateSubmission) {
      return res.status(400).json({
        success: false,
        message: 'Assignment deadline has passed and late submissions are not allowed'
      });
    }
    const existingSubmissionIndex = assignment.submissions.findIndex(
      sub => sub.studentId.toString() === userId
    );

    const submissionData = {
      studentId: new mongoose.Types.ObjectId(userId),
      content: content.trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
      submittedAt: now,
      isLate: isOverdue,
      status: 'submitted'
    };

    if (existingSubmissionIndex !== -1) {
      assignment.submissions[existingSubmissionIndex] = {
        ...assignment.submissions[existingSubmissionIndex].toObject(),
        ...submissionData,
        resubmittedAt: now
      };
    } else {
      assignment.submissions.push(submissionData);
    }

    await assignment.save();

    // Populate the updated assignment
    await assignment.populate('submissions.studentId', 'name email');

    const userSubmission = assignment.submissions.find(
      sub => sub.studentId._id.toString() === userId
    );

    res.status(200).json({
      success: true,
      message: existingSubmissionIndex !== -1 ? 'Assignment resubmitted successfully' : 'Assignment submitted successfully',
      submission: userSubmission,
      isLate: isOverdue,
      submittedAt: now
    });

  } catch (err) {
    console.error('Error submitting assignment:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to submit assignment',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

// Get Assignment Submissions (for instructors/coordinators)
exports.getAssignmentSubmissions = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status, sortBy, sortOrder, page, limit } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!isValidObjectId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Assignment ID format'
      });
    }

    const assignment = await Assignment.findById(assignmentId)
      .populate('classId', 'createdBy coordinators className')
      .populate('submissions.studentId', 'name email profilePicture');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check permissions
    const isCreator = assignment.createdBy.toString() === userId;
    const isClassCreator = assignment.classId.createdBy.toString() === userId;
    const isCoordinator = assignment.classId.coordinators.some(coord => coord.toString() === userId);

    if (!isCreator && !isClassCreator && !isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let submissions = assignment.submissions || [];

    // Filter by status if provided
    if (status) {
      const validStatuses = ['submitted', 'graded', 'pending'];
      if (validStatuses.includes(status)) {
        submissions = submissions.filter(sub => {
          if (status === 'graded') return sub.marks !== undefined;
          if (status === 'pending') return sub.marks === undefined;
          return sub.status === status;
        });
      }
    }

    // Sorting
    if (sortBy) {
      const validSortFields = ['submittedAt', 'marks', 'studentName'];
      if (validSortFields.includes(sortBy)) {
        submissions.sort((a, b) => {
          let aVal, bVal;
          
          if (sortBy === 'studentName') {
            aVal = a.studentId?.name || '';
            bVal = b.studentId?.name || '';
          } else if (sortBy === 'marks') {
            aVal = a.marks || 0;
            bVal = b.marks || 0;
          } else {
            aVal = new Date(a[sortBy]);
            bVal = new Date(b[sortBy]);
          }

          if (sortOrder === 'asc') {
            return aVal > bVal ? 1 : -1;
          } else {
            return aVal < bVal ? 1 : -1;
          }
        });
      }
    }

    // Pagination
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const startIndex = (pageNumber - 1) * limitNumber;
    const endIndex = startIndex + limitNumber;

    const paginatedSubmissions = submissions.slice(startIndex, endIndex);
    const totalPages = Math.ceil(submissions.length / limitNumber);

    res.status(200).json({
      success: true,
      submissions: paginatedSubmissions,
      assignment: {
        _id: assignment._id,
        title: assignment.title,
        maxMarks: assignment.maxMarks,
        dueDate: assignment.dueDate,
        className: assignment.classId.className
      },
      pagination: {
        currentPage: pageNumber,
        totalPages,
        totalCount: submissions.length,
        hasNext: pageNumber < totalPages,
        hasPrev: pageNumber > 1,
        limit: limitNumber
      }
    });

  } catch (err) {
    console.error('Error fetching assignment submissions:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment submissions',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

// Grade Assignment Submission
exports.gradeSubmission = async (req, res) => {
  try {
    const { assignmentId, submissionId } = req.params;
    const { marks, feedback } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!isValidObjectId(assignmentId) || !isValidObjectId(submissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    // Validate marks
    if (marks === undefined || marks === null) {
      return res.status(400).json({
        success: false,
        message: 'Marks are required'
      });
    }

    const marksNumber = Number(marks);
    if (isNaN(marksNumber) || marksNumber < 0) {
      return res.status(400).json({
        success: false,
        message: 'Marks must be a non-negative number'
      });
    }

    const assignment = await Assignment.findById(assignmentId)
      .populate('classId', 'createdBy coordinators');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check permissions
    const isCreator = assignment.createdBy.toString() === userId;
    const isClassCreator = assignment.classId.createdBy.toString() === userId;
    const isCoordinator = assignment.classId.coordinators.some(coord => coord.toString() === userId);

    if (!isCreator && !isClassCreator && !isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Validate marks against maxMarks
    if (marksNumber > assignment.maxMarks) {
      return res.status(400).json({
        success: false,
        message: `Marks cannot exceed maximum marks (${assignment.maxMarks})`
      });
    }

    // Find and update submission
    const submissionIndex = assignment.submissions.findIndex(
      sub => sub._id.toString() === submissionId
    );

    if (submissionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    assignment.submissions[submissionIndex].marks = marksNumber;
    assignment.submissions[submissionIndex].feedback = feedback?.trim() || '';
    assignment.submissions[submissionIndex].gradedAt = new Date();
    assignment.submissions[submissionIndex].gradedBy = new mongoose.Types.ObjectId(userId);
    assignment.submissions[submissionIndex].status = 'graded';

    await assignment.save();

    await assignment.populate('submissions.studentId', 'name email');
    await assignment.populate('submissions.gradedBy', 'name email');

    const gradedSubmission = assignment.submissions[submissionIndex];

    res.status(200).json({
      success: true,
      message: 'Submission graded successfully',
      submission: gradedSubmission
    });

  } catch (err) {
      console.error('Error grading submission:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to grade submission',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
      });
    }
  };