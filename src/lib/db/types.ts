/**
 * Row types mirroring db/migrations. Keep in sync when adding migrations.
 * DECIMAL columns are strings (exact); DATETIME columns are Date (UTC).
 */
import type { AppRole } from "@/lib/auth/roles";

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  is_demo: number;
  created_at: Date;
  updated_at: Date;
};

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  password_hash: string;
  must_change_password: number;
  status: "active" | "disabled";
  last_login_at: Date | null;
  password_changed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type MembershipRow = {
  organization_id: string;
  user_id: string;
  role: AppRole;
  status: "active" | "suspended";
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ProductStatus = "active" | "inactive" | "discontinued";
export type ProductType = "single" | "bundle";
export type SizeUnit = "g" | "kg" | "ml" | "l" | "pcs";
