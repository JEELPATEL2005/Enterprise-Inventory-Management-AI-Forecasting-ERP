const Employee = require("../Models/Employee");
const Role = require("../Models/Role");
const Warehouse = require("../Models/Warehouse");
const { hashPassword } = require("../services/auth");
const create = async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.email || !b.password || !b.role) {
      return res
        .status(400)
        .json({
          success: false,
          message: "name, email, password, and role are required",
        });
    }

    let dept = b.department;
    if (!dept) {
      const r = await Role.findById(b.role);
      const rName = r?.roleName?.toUpperCase();
      if (rName === "PURCHASE_MANAGER") dept = "PURCHASE";
      else if (rName === "WAREHOUSE_MANAGER") dept = "WAREHOUSE";
      else if (rName === "SALES_MANAGER") dept = "SALES";
      else dept = "ADMIN";
    }

    const d = await Employee.create({
      ...b,
      department: dept,
      password: await hashPassword(b.password),
    });

    // If assignedWarehouses provided, sync with Warehouse.primaryManager for facilities without one
    if (b.assignedWarehouses && Array.isArray(b.assignedWarehouses) && b.assignedWarehouses.length > 0) {
      await Warehouse.updateMany(
        { _id: { $in: b.assignedWarehouses }, primaryManager: null },
        { primaryManager: d._id }
      );
    }

    const out = await Employee.findById(d._id)
      .populate("role", "roleName permissions")
      .populate("assignedWarehouses", "warehouseName location status capacity")
      .select("-password");
    res.status(201).json({ success: true, data: out });
  } catch (e) {
    next(e);
  }
};
const list = async (req, res, next) => {
  try {
    const docs = await Employee.find()
      .populate("role", "roleName permissions")
      .populate("assignedWarehouses", "warehouseName location status capacity")
      .select("-password")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: docs.length, data: docs });
  } catch (e) {
    next(e);
  }
};
const get = async (req, res, next) => {
  try {
    const d = await Employee.findById(req.params.id)
      .populate("role", "roleName permissions")
      .populate("assignedWarehouses", "warehouseName location status capacity")
      .select("-password");
    if (!d)
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    res.json({ success: true, data: d });
  } catch (e) {
    next(e);
  }
};
const update = async (req, res, next) => {
  try {
    const b = { ...req.body };
    if (b.password) b.password = await hashPassword(b.password);

    const oldEmp = await Employee.findById(req.params.id);
    if (!oldEmp) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }

    // Bidirectional sync for assignedWarehouses
    if (b.assignedWarehouses && Array.isArray(b.assignedWarehouses)) {
      const oldWhs = (oldEmp.assignedWarehouses || []).map(String);
      const newWhs = b.assignedWarehouses.map(String);
      const removedWhs = oldWhs.filter((id) => !newWhs.includes(id));
      const addedWhs = newWhs.filter((id) => !oldWhs.includes(id));

      if (removedWhs.length > 0) {
        await Warehouse.updateMany(
          { _id: { $in: removedWhs }, primaryManager: req.params.id },
          { primaryManager: null }
        );
      }
      if (addedWhs.length > 0) {
        await Warehouse.updateMany(
          { _id: { $in: addedWhs }, primaryManager: null },
          { primaryManager: req.params.id }
        );
      }
    }

    const d = await Employee.findByIdAndUpdate(req.params.id, b, {
      returnDocument: "after",
      runValidators: true,
    })
      .populate("role", "roleName permissions")
      .populate("assignedWarehouses", "warehouseName location status capacity")
      .select("-password");

    res.json({ success: true, data: d });
  } catch (e) {
    next(e);
  }
};
const remove = async (req, res, next) => {
  try {
    const d = await Employee.findByIdAndUpdate(
      req.params.id,
      { status: "INACTIVE" },
      { new: true },
    );
    if (!d)
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    res.json({ success: true, message: "Employee deactivated" });
  } catch (e) {
    next(e);
  }
};
module.exports = { create, list, get, update, remove };
