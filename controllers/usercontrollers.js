const User = require("../models/User");


exports.updateProfile = async (req, res) => {
    try {
        console.log("Received body data:", req.body);
        console.log("Request user object:", req.user);

        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { 
            name, 
            bio, 
            phone, 
            grade, 
            subject, 
            school, 
            studentId, 
            teacherId,
            profilePicture,
            message  // Add message field
        } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        console.log("User found in DB:", user);

        // Update allowed fields
        if (name !== undefined) user.name = name;
        if (bio !== undefined) user.bio = bio;
        if (phone !== undefined) user.phone = phone;
        if (grade !== undefined) user.grade = grade;
        if (subject !== undefined) user.subject = subject;
        if (school !== undefined) user.school = school;
        if (studentId !== undefined) user.studentId = studentId;
        if (teacherId !== undefined) user.teacherId = teacherId;
        if (profilePicture !== undefined) user.profilePicture = profilePicture;
        if (message !== undefined) user.message = message; // Add message update

        await user.save();

        console.log("Updated user profile:", user);

        res.json({ 
            message: "Profile updated successfully", 
            user: {
                name: user.name,
                bio: user.bio,
                phone: user.phone,
                grade: user.grade,
                subject: user.subject,
                school: user.school,
                studentId: user.studentId,
                teacherId: user.teacherId,
                profilePicture: user.profilePicture,
                message: user.message  // Include message in response
            }
        });
    } catch (error) {
        console.error("Error in updateProfile:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Add a new method to update user status message
exports.updateMessage = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { message } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: "Message is required" });
        }

        if (message.length > 200) {
            return res.status(400).json({ error: "Message must be less than 200 characters" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        user.message = message.trim();
        await user.save();

        res.json({ 
            message: "Status message updated successfully", 
            userMessage: user.message
        });
    } catch (error) {
        console.error("Error in updateMessage:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Update user preferences
exports.updatePreferences = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { emailNotifications, pushNotifications, theme, language } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Initialize preferences if not exists
        user.preferences = user.preferences || {};

        if (emailNotifications !== undefined) user.preferences.emailNotifications = emailNotifications;
        if (pushNotifications !== undefined) user.preferences.pushNotifications = pushNotifications;
        if (theme !== undefined) user.preferences.theme = theme;
        if (language !== undefined) user.preferences.language = language;

        user.markModified("preferences");
        await user.save();

        res.json({ 
            message: "Preferences updated successfully", 
            preferences: user.preferences 
        });
    } catch (error) {
        console.error("Error in updatePreferences:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Get user profile
exports.getProfile = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id)
            .populate('classrooms.classroomId', 'name subject')
            .select('-password -refreshToken');

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ user });
    } catch (error) {
        console.error("Error in getProfile:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Join a classroom
exports.joinClassroom = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { classroomId, role = 'student' } = req.body;

        if (!classroomId) {
            return res.status(400).json({ error: "Classroom ID is required" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Check if already joined
        const existingClassroom = user.classrooms.find(
            classroom => classroom.classroomId.toString() === classroomId
        );

        if (existingClassroom) {
            return res.status(400).json({ error: "Already joined this classroom" });
        }

        // Add classroom to user
        user.classrooms.push({
            classroomId: classroomId,
            role: role,
            joinedAt: new Date()
        });

        await user.save();

        res.json({ 
            message: "Successfully joined classroom",
            classroom: user.classrooms[user.classrooms.length - 1]
        });
    } catch (error) {
        console.error("Error in joinClassroom:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Leave a classroom
exports.leaveClassroom = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { classroomId } = req.body;

        if (!classroomId) {
            return res.status(400).json({ error: "Classroom ID is required" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Remove classroom from user
        user.classrooms = user.classrooms.filter(
            classroom => classroom.classroomId.toString() !== classroomId
        );

        await user.save();

        res.json({ message: "Successfully left classroom" });
    } catch (error) {
        console.error("Error in leaveClassroom:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Get user notifications
exports.getNotifications = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id).select('notifications');
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Sort notifications by creation date (newest first)
        const notifications = user.notifications.sort((a, b) => b.createdAt - a.createdAt);

        res.json({ notifications });
    } catch (error) {
        console.error("Error in getNotifications:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Mark notification as read
exports.markNotificationRead = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { notificationId } = req.body;

        if (!notificationId) {
            return res.status(400).json({ error: "Notification ID is required" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Find and mark notification as read
        const notification = user.notifications.id(notificationId);
        if (!notification) {
            return res.status(404).json({ error: "Notification not found" });
        }

        notification.isRead = true;
        await user.save();

        res.json({ message: "Notification marked as read" });
    } catch (error) {
        console.error("Error in markNotificationRead:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Get user dashboard data
exports.getDashboard = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id)
            .populate('classrooms.classroomId', 'name subject')
            .select('-password -refreshToken');

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Get unread notifications count
        const unreadNotifications = user.notifications.filter(notif => !notif.isRead).length;

        const dashboardData = {
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
                profilePicture: user.profilePicture
            },
            classrooms: user.classrooms,
            academicStats: user.academicStats,
            unreadNotifications,
            recentNotifications: user.notifications
                .filter(notif => !notif.isRead)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 5)
        };

        res.json(dashboardData);
    } catch (error) {
        console.error("Error in getDashboard:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};