const jwt = require("jsonwebtoken");

exports.protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      console.log("No token provided");
      return res.status(401).json({ error: "Unauthorized, no token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded Token:", decoded);

    req.user = { id: decoded.id };

    if (!req.user.id) {
      console.log("User ID not found in token");
      return res.status(401).json({ error: "User ID not found in token" });
    }

    next();
  } catch (error) {
    console.log("JWT verification failed:", error.message);
    res.status(401).json({ error: "Unauthorized, invalid token" });
  }
};
