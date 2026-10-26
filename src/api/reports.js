import express from "express";
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Configure Supabase admin client with Service Role Key to bypass RLS
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "https://iksjhjxwphmvthryfeae.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }
);

// ==========================================
// GET Income Statement API
// ==========================================
router.post("/income-statement", async (req, res) => {
  try {
    const { p_start_date, p_end_date } = req.body;
    if (!p_start_date || !p_end_date) {
      return res.status(400).json({ error: "Dates are required" });
    }

    const { data, error } = await supabaseAdmin.rpc("fn_income_statement", {
      p_start_date,
      p_end_date,
    });

    if (error) {
      console.error("fn_income_statement error:", error);
      return res.status(500).json({ error: error.message || "Failed to fetch income statement" });
    }

    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Income statement API error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// GET Balance Sheet API
// ==========================================
router.post("/balance-sheet", async (req, res) => {
  try {
    const { p_as_of_date } = req.body;
    if (!p_as_of_date) {
      return res.status(400).json({ error: "Date is required" });
    }

    const { data, error } = await supabaseAdmin.rpc("fn_balance_sheet", {
      p_as_of_date,
    });

    if (error) {
      console.error("fn_balance_sheet error:", error);
      return res.status(500).json({ error: error.message || "Failed to fetch balance sheet" });
    }

    res.json({ success: true, data });
  } catch (err: any) {
    console.error("Balance sheet API error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// POST Period Close API
// ==========================================
router.post("/period-close", async (req, res) => {
  try {
    const { p_period_date, p_user_id } = req.body;
    if (!p_period_date || !p_user_id) {
      return res.status(400).json({ error: "Period date and user ID are required" });
    }

    const { data, error } = await supabaseAdmin.rpc("fn_period_close", {
      p_period_date,
      p_user_id,
    });

    if (error) {
      console.error("fn_period_close error:", error);
      return res.status(500).json({ error: error.message || "Failed to close period" });
    }

    res.json({ success: true, message: "Period closed successfully", data });
  } catch (err: any) {
    console.error("Period close API error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// POST Retain Earnings Transfer API
// ==========================================
router.post("/retain-earnings-transfer", async (req, journal_entry) => {
  try {
    const { p_period_end_date, p_user_id } = req.body;
    if (!p_period_end_date || !p_user_id) {
      return res.status(400).json({ error: "Period end date and user ID are required" });
    }

    const { data, error } = await supabaseAdmin.rpc("fn_retain_earnings_transfer", {
      p_period_end_date,
      p_user_id,
    });

    if (error) {
      console.error("fn_retain_earnings_transfer error:", error);
      return res.status(500).json({ error: error.message || "Failed to transfer retained earnings" });
    }

    res.json({ success: true, message: data || "Transfer completed", data });
  } catch (err: any) {
    console.error("Retain earnings transfer API error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

export default router;