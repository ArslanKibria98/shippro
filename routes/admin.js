const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const Admin = require("../models/admin");
const User = require("../models/user")
const authMiddleware = require("../middleware/authMiddleware"); // Protect admin routes
const shipTs = require("../models/shipTs");

require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET || "default_secret"; // Ensure this is set

const router = express.Router();

// ⛔️ Rate limiting to prevent brute-force attacks (5 requests per 15 minutes)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Max 5 attempts
    message: { msg: "Too many login attempts. Please try again later." },
});

// ✅ Admin Registration (Secure)
router.post(
    "/register",
    [
        body("name").trim().notEmpty().withMessage("Name is required"),
        body("email").isEmail().withMessage("Invalid email"),
        body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { name, email, password } = req.body;

            // Check if admin already exists
            let admin = await Admin.findOne({ email });
            if (admin) {
                return res.status(400).json({ msg: "Admin already exists" });
            }

            // Hash password with bcrypt
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Create new admin
            admin = new Admin({ name, email, password: hashedPassword });
            await admin.save();

            res.status(201).json({ msg: "Admin registered successfully" });
        } catch (error) {
            console.error(error);
            res.status(500).json({ msg: "Server error" });
        }
    }
);

// ✅ Admin Login (Secure)
router.post(
    "/login",
    loginLimiter, // ⛔ Apply rate limiting
    [
        body("email").isEmail().withMessage("Invalid email"),
        body("password").notEmpty().withMessage("Password is required"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        try {
            const admin = await Admin.findOne({ email });

            // Security: Avoid revealing whether email exists
            if (!admin || !(await bcrypt.compare(password, admin.password))) {
                return res.status(400).json({ msg: "Invalid email or password" });
            }

            // Generate JWT token
            const token = jwt.sign(
                { userId: admin._id, role: "admin" },
                JWT_SECRET,
                { expiresIn: "1h" }
            );

            res.json({ token });
        } catch (err) {
            console.error(err);
            res.status(500).json({ msg: "Server error" });
        }
    }
);


router.get("/users", authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ msg: "Access denied" });
        }

        const users = await User.find().select("-password"); // Exclude password
        res.status(200).json(users);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ msg: "Server error" });
    }
});


// ✅ 2. Block/Unblock a user
router.put("/users/:id/status", authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ msg: "Access denied" });
        }

        const { status } = req.body;
        const updatedUser = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });

        if (!updatedUser) return res.status(404).json({ msg: "User not found" });

        res.status(200).json({ msg: "User status updated successfully", updatedUser });
    } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).json({ msg: "Server error" });
    }
});


// ✅ 3. Increase/Decrease user balance
router.put("/users/:id/balance", authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ msg: "Access denied" });
        }

        const { availableBalance } = req.body;
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            { availableBalance },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ msg: "User not found" });

        res.status(200).json({ msg: "User balance updated successfully", updatedUser });
    } catch (error) {
        console.error("Error updating user balance:", error);
        res.status(500).json({ msg: "Server error" });
    }
});


router.post("/upload-shipments", async (req, res) => {
  try {
    const { rows } = req.body; // 'rows' is an array of objects from Excel
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ msg: "No rows provided" });
    }

    // Transform each row to match the ShipmentSchema
    const shipmentsToInsert = rows.map(row => ({
      carrier: row.Carrier,
      tracking: row.tracking,
      labelType: row.labelType,
    }));

    // Insert all in one go
    await shipTs.insertMany(shipmentsToInsert);

    res.json({ msg: "Shipments saved successfully" });
  } catch (error) {
    console.error("Error saving shipments:", error);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/read/shipts", async (req, res) => {
    try {
      // Retrieve all shipments from the database
      const shipments = await shipTs.find({});
      // Respond with the list of shipments
      res.json(shipments);
    } catch (error) {
      console.error("Error fetching shipments:", error);
      res.status(500).json({ msg: "Server error", error: error.message });
    }
  });
  router.post("/pull/shipts", async (req, res) => {
    try {
      const { labelType, carrier } = req.body;
      if (!labelType || !carrier) {
        return res.status(400).json({ msg: "labelType and carrier are required" });
      }
    //   labelType = labelType.toLowerCase();
    //   carrier = carrier.toLowerCase();
  
      // Find the first matching shipment and delete it atomically
      const shipment = await shipTs.findOneAndDelete({ labelType, carrier });
      if (!shipment) {
        return res.status(404).json({ msg: "No matching shipment found" });
      }
  
      res.json({
        msg: "Shipment retrieved and deleted successfully",
        shipment,
      });
    } catch (error) {
      console.error("Error pulling shipment:", error);
      res.status(500).json({ msg: "Server error", error: error.message });
    }
  });
  
  // update isDealer

  router.put("/:userId/is-dealer", async (req, res) => {
    try {
        const { userId } = req.params;
        const { isDealer } = req.body;

        // Validate input
        if (typeof isDealer !== "boolean") {
            return res.status(400).json({ message: "isDealer must be a boolean value (true or false)." });
        }

        // Find and update user
        const user = await User.findByIdAndUpdate(
            userId,
            { isDealer },
            { new: true } // Return the updated document
        );

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        res.status(200).json({ message: "User updated successfully", user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error" });
    }
});


router.put("/:userId/carriers", authMiddleware, async (req, res) => {
  try {
      const { userId } = req.params;
      const { allowedCarriers } = req.body;

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ msg: "User not found" });

      user.allowedCarriers = allowedCarriers;
      await user.save();

      res.json({ msg: "Carriers updated successfully!", user });
  } catch (error) {
      res.status(500).json({ msg: "Server Error", error });
  }
});


//////////
router.post("/add-carrier", authMiddleware, async (req, res) => {
    try {
        const { userId, carrier } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: "User not found" });

        // Add carrier if it doesn't exist
        if (!user.allowedCarriers.some(c => c.carrier === carrier)) {
            user.allowedCarriers.push({ carrier, allowedVendors: [], status: false });
            await user.save();
            return res.json({ msg: "Carrier added successfully", user });
        } else {
            return res.status(400).json({ msg: "Carrier already exists" });
        }
    } catch (error) {
        res.status(500).json({ msg: "Server Error", error });
    }
});

// Add a vendor to a carrier (Admin Only)
router.post("/add-vendor", authMiddleware, async (req, res) => {
    try {
        const { userId, carrier, vendor } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: "User not found" });

        // Find the carrier and add the vendor
        const carrierObj = user.allowedCarriers.find(c => c.carrier === carrier);
        if (!carrierObj) return res.status(404).json({ msg: "Carrier not found" });

        if (!carrierObj.allowedVendors.includes(vendor)) {
            carrierObj.allowedVendors.push(vendor);
            await user.save();
            return res.json({ msg: "Vendor added successfully", user });
        } else {
            return res.status(400).json({ msg: "Vendor already exists" });
        }
    } catch (error) {
        res.status(500).json({ msg: "Server Error", error });
    }
});

// Update Carrier Status (Allow/Block) (Admin Only)
router.put("/update-carrier-status", authMiddleware, async (req, res) => {
    try {
        const { userId, carrier, status } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: "User not found" });

        const carrierObj = user.allowedCarriers.find(c => c.carrier === carrier);
        if (!carrierObj) return res.status(404).json({ msg: "Carrier not found" });

        carrierObj.status = status;
        await user.save();

        return res.json({ msg: "Carrier status updated", user });
    } catch (error) {
        res.status(500).json({ msg: "Server Error", error });
    }
});

// Update Vendor Status (Allow/Block) (Admin Only)
router.put("/update-vendor-status", authMiddleware, async (req, res) => {
    try {
        const { userId, carrier, vendor, status } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: "User not found" });

        const carrierObj = user.allowedCarriers.find(c => c.carrier === carrier);
        if (!carrierObj) return res.status(404).json({ msg: "Carrier not found" });

        // Check if vendor exists
        if (!carrierObj.allowedVendors.includes(vendor)) {
            return res.status(404).json({ msg: "Vendor not found" });
        }

        // Update vendor status (new way: keep a separate status for vendors if needed)
        carrierObj.allowedVendors = carrierObj.allowedVendors.map(v => 
            v === vendor ? { name: v, status } : v
        );

        await user.save();

        return res.json({ msg: "Vendor status updated", user });
    } catch (error) {
        res.status(500).json({ msg: "Server Error", error });
    }
});



module.exports = router;
