const express = require("express");
const Address = require("../models/Address");

const router = express.Router();

/**
 * ✅ GET USER ADDRESSES
 * GET /addresses/:userId
 */
router.get("/:userId", async (req, res) => {
  try {
    const addresses = await Address.find({ user: req.params.userId }).sort({
      isDefault: -1,
      createdAt: -1,
    });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ GET SINGLE ADDRESS
 * GET /addresses/single/:id
 */
router.get("/single/:id", async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }

    res.json(address);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ ADD ADDRESS (MAX 3)
 * POST /addresses
 */
router.post("/", async (req, res) => {
  try {
    const {
      user,
      type,
      name,
      phone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      location,
      isDefault,
    } = req.body;

    // Validate required fields
    if (!user || !phone || !addressLine1 || !city || !state || !pincode) {
      return res.status(400).json({
        error: "Please provide all required address fields",
      });
    }

    // Validate phone number (10 digits)
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        error: "Please provide a valid 10-digit phone number",
      });
    }

    // Validate pincode (6 digits)
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        error: "Please provide a valid 6-digit pincode",
      });
    }

    // Check if user already has 3 addresses
    const count = await Address.countDocuments({ user });

    if (count >= 3) {
      return res.status(400).json({
        error:
          "You can only add up to 3 addresses. Please delete an existing address first.",
      });
    }

    // If this address is set as default, unset other default addresses
    if (isDefault) {
      await Address.updateMany({ user }, { $set: { isDefault: false } });
    }

    // If this is the first address, make it default automatically
    const isFirstAddress = count === 0;

    const addressData = {
      user,
      type: type || "home",
      phone,
      addressLine1: addressLine1.trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      isDefault: isDefault || isFirstAddress,
    };

    // Add optional fields if provided
    if (name) addressData.name = name.trim();
    if (addressLine2) addressData.addressLine2 = addressLine2.trim();
    if (landmark) addressData.landmark = landmark.trim();

    // Add location coordinates if provided
    if (location && location.coordinates && location.coordinates.length === 2) {
      addressData.location = {
        type: "Point",
        coordinates: location.coordinates, // [lng, lat]
      };
    }

    const address = await Address.create(addressData);

    res.status(201).json(address);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * ✅ UPDATE ADDRESS
 * PUT /addresses/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const {
      type,
      name,
      phone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      location,
      isDefault,
    } = req.body;

    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }

    // Validate phone if provided
    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        error: "Please provide a valid 10-digit phone number",
      });
    }

    // Validate pincode if provided
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        error: "Please provide a valid 6-digit pincode",
      });
    }

    // If setting this as default, unset other defaults
    if (isDefault && !address.isDefault) {
      await Address.updateMany(
        { user: address.user, _id: { $ne: req.params.id } },
        { $set: { isDefault: false } },
      );
    }

    // Update address fields
    if (type) address.type = type;
    if (name !== undefined) address.name = name ? name.trim() : name;
    if (phone) address.phone = phone;
    if (addressLine1) address.addressLine1 = addressLine1.trim();
    if (addressLine2 !== undefined)
      address.addressLine2 = addressLine2 ? addressLine2.trim() : addressLine2;
    if (landmark !== undefined)
      address.landmark = landmark ? landmark.trim() : landmark;
    if (city) address.city = city.trim();
    if (state) address.state = state.trim();
    if (pincode) address.pincode = pincode.trim();
    if (isDefault !== undefined) address.isDefault = isDefault;

    // Update location if provided
    if (location && location.coordinates && location.coordinates.length === 2) {
      address.location = {
        type: "Point",
        coordinates: location.coordinates,
      };
    }

    await address.save();

    res.json(address);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * ✅ SET ADDRESS AS DEFAULT
 * PUT /addresses/:id/default
 */
router.put("/:id/default", async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }

    // Unset all other default addresses for this user
    await Address.updateMany(
      { user: address.user },
      { $set: { isDefault: false } },
    );

    // Set this address as default
    address.isDefault = true;
    await address.save();

    res.json(address);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * ✅ DELETE ADDRESS
 * DELETE /addresses/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }

    const wasDefault = address.isDefault;
    const userId = address.user;

    await address.deleteOne();

    // If deleted address was default, set another address as default
    if (wasDefault) {
      const nextAddress = await Address.findOne({ user: userId });
      if (nextAddress) {
        nextAddress.isDefault = true;
        await nextAddress.save();
      }
    }

    res.json({ message: "Address deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ FIND ADDRESSES NEAR LOCATION (GEO SEARCH)
 * POST /addresses/nearby
 * Body: { longitude, latitude, maxDistance }
 */
router.post("/nearby", async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 5000 } = req.body; // default 5km

    if (!longitude || !latitude) {
      return res.status(400).json({
        error: "Please provide longitude and latitude",
      });
    }

    const addresses = await Address.find({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: maxDistance, // in meters
        },
      },
    });

    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ GET DEFAULT ADDRESS FOR USER
 * GET /addresses/:userId/default
 */
router.get("/:userId/default", async (req, res) => {
  try {
    const address = await Address.findOne({
      user: req.params.userId,
      isDefault: true,
    });

    if (!address) {
      return res.status(404).json({ error: "No default address found" });
    }

    res.json(address);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ GET ADDRESSES BY TYPE
 * GET /addresses/:userId/type/:type
 */
router.get("/:userId/type/:type", async (req, res) => {
  try {
    const { userId, type } = req.params;

    if (!["home", "work", "other"].includes(type)) {
      return res.status(400).json({
        error: "Invalid address type. Must be home, work, or other",
      });
    }

    const addresses = await Address.find({
      user: userId,
      type: type,
    }).sort({ isDefault: -1, createdAt: -1 });

    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
