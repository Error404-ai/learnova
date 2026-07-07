const jwt = require("jsonwebtoken");
const User = require("../models/User");

exports.protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        try {
            token = req.headers.authorization.split(" ")[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            req.user = await User.findById(decoded.id);

            if (!req.user) {
                return res.status(404).json({ error: "User not found" });
            }

            next();
        } catch (error) {
            console.error("Authentication failed:", error);
            return res.status(401).json({ error: "Not authorized" });
        }
    }

    if (!token) {
        return res.status(401).json({ error: "No token, not authorized" });
    }
};

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. This action is restricted to: ${roles.join(', ')}`
      });
    }
    next();
  };
};
