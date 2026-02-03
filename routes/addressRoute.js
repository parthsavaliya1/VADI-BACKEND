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
 * ✅ ADD ADDRESS (MAX 3)
 * POST /addresses
 */
router.post("/", async (req, res) => {
  try {
    const { user, name, addressLine, city, state, pincode, isDefault } =
      req.body;

    // Validate required fields
    if (!user || !addressLine || !city || !state || !pincode) {
      return res.status(400).json({
        error: "Please provide all required address fields",
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

    const address = await Address.create({
      user,
      name,
      addressLine,
      city,
      state,
      pincode,
      isDefault: isDefault || isFirstAddress,
    });

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
    const { name, addressLine, city, state, pincode, isDefault } = req.body;

    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }

    // If setting this as default, unset other defaults
    if (isDefault && !address.isDefault) {
      await Address.updateMany(
        { user: address.user, _id: { $ne: req.params.id } },
        { $set: { isDefault: false } },
      );
    }

    // Update address fields
    address.name = name || address.name;
    address.addressLine = addressLine || address.addressLine;
    address.city = city || address.city;
    address.state = state || address.state;
    address.pincode = pincode || address.pincode;
    address.isDefault = isDefault !== undefined ? isDefault : address.isDefault;

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

module.exports = router;
