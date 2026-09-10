import bcrypt from "bcryptjs";
import { supabase } from "../db/supabase.js";
import { config } from "../config.js";

const email = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3] || "";

if (!email || !password) {
  console.error("Usage: npm run create-admin -- you@example.com your-password");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const password_hash = await bcrypt.hash(password, 12);
const { data, error } = await supabase
  .from("admins")
  .upsert({ email, password_hash }, { onConflict: "email" })
  .select("id, email, created_at")
  .single();

if (error) {
  console.error("Failed to create admin:", error.message);
  console.error("Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env");
  process.exit(1);
}

console.log("Admin ready:", data);
console.log("API:", config.publicBaseUrl);
