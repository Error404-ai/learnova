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

    const classObj = await Class.findById(classId);
    if (!classObj) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    const isCreator = classObj.createdBy.toString() === userId.toString();
    const isCoordinator = classObj.coordinators.some(coord => coord.toString() === userId.toString());

    if (!isCreator && !isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Only class creator or coordinators can create assignments'
      });
    }

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
    if (maxMarks !== undefined) {
      const marks = Number(maxMarks);
      if (isNaN(marks) || marks <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Maximum marks must be a positive number'
        });
      }
    }

    const validCategories = ['assignment', 'quiz', 'project', 'exam', 'homework'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Must be one of: ' + validCategories.join(', ')
      });
    }

    // Create assignment
    const assignmentData = {
      title: title.trim(),
      description: description.trim(),
      classId: new mongoose.Types.ObjectId(classId),
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

    // Populate the assignment
    await newAssignment.populate([
      { path: 'createdBy', select: 'name email profilePicture' },
      { path: 'classId', select: 'className subject' }
    ]);

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
      message: 'Assignment created successfully',
      assignment: responseData
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

    // Check class access
    const { hasPermission, error, classObj, isCreator, isCoordinator, isStudent } = 
      await checkClassPermission(classId, userId);

    if (!hasPermission) {
      return res.status(error === 'Class not found' ? 404 : 403).json({
        success: false,
        message: error || 'Access denied to this class'
      });
    }

    // Build query
    const query = { classId: new mongoose.Types.ObjectId(classId) };
    
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

    // Fetch assignments
    const assignments = await Assignment.find(query)
      .populate('createdBy', 'name email profilePicture')
      .populate('classId', 'className subject')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNumber)
      .lean();

    // Process assignments with user-specific data
    const assignmentsWithStatus = assignments.map(assignment => {
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
        canDelete: assignment.createdBy._id.toString() === userId
      };
    });

    res.status(200).json({
      success: true,
      assignments: assignmentsWithStatus,
      pagination: {
        currentPage: pageNumber,
        totalPages,
        totalCount,
        hasNext: pageNumber < totalPages,
        hasPrev: pageNumber > 1,
        limit: limitNumber
      },
      className: classObj.className,
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

exports.getAssignmentById = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;

    console.log('Get assignment by ID:', { assignmentId, userId });

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

    // Fetch assignment with populated data
    const assignment = await Assignment.findById(assignmentId)
      .populate('createdBy', 'name email profilePicture')
      .populate('classId', 'className subject createdBy students coordinators')
      .populate('submissions.studentId', 'name email profilePicture')
      .lean();

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check access permissions
    const classObj = assignment.classId;
    const isCreator = classObj.createdBy.toString() === userId;
    const isCoordinator = classObj.coordinators.some(coord => coord.toString() === userId);
    const isStudent = classObj.students.some(student => student.toString() === userId);
    const isAssignmentCreator = assignment.createdBy._id.toString() === userId;

    if (!isCreator && !isCoordinator && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this assignment'
      });
    }

    // Find user's submission
    const userSubmission = assignment.submissions?.find(
      sub => sub.studentId?._id?.toString() === userId
    );

    // Prepare response data based on user role
    const responseData = {
      ...assignment,
      hasSubmitted: !!userSubmission,
      userSubmission: isStudent ? userSubmission : undefined,
      submissionsCount: assignment.submissions?.length || 0,
      isOverdue: assignment.dueDate && new Date() > new Date(assignment.dueDate),
      isCreator: isAssignmentCreator,
      canEdit: isCreator || isCoordinator || isAssignmentCreator,
      canDelete: isAssignmentCreator,
      canViewAllSubmissions: isCreator || isCoordinator || isAssignmentCreator,
      userRole: isCreator ? 'creator' : isCoordinator ? 'coordinator' : 'student'
    };

    // Hide sensitive data for students
    if (isStudent && !isCreator && !isCoordinator) {
      // Students can only see their own submission details
      responseData.submissions = userSubmission ? [userSubmission] : [];
    }

    res.status(200).json({
      success: true,
      assignment: responseData
    });

  } catch (err) {
    console.error('Error fetching assignment:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment details',
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