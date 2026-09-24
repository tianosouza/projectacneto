export type UserRole = "admin" | "operator" | "driver" | "carrier";

export type Profile = {
  id: string;
  user_id: string;
  role: UserRole;
  full_name: string | null;
  created_at: string;
  must_change_password?: boolean;
  finance_enabled?: boolean;
  negotiations_enabled?: boolean;
  is_super_admin?: boolean;
};

export type DriverStatus =
  | "offline"
  | "available"
  | "awaiting_loading"
  | "awaiting_documents"
  | "in_transit"
  | "awaiting_unloading"
  | "in_negotiation"
  | "on_trip";

export type Driver = {
  id: string;
  user_id: string;
  full_name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  capacity: string | null;
  compartments: string | null;
  plate: string | null;
  cnh: string | null;
  cnh_category?: string | null;
  cnh_expires_at?: string | null;
  city: string | null;
  state: string | null;
  homologation_status?:
    | "in_analysis"
    | "active"
    | "rejected"
    | "blocked"
    | string;
  location_sharing_authorized?: boolean;
  current_vehicle?: Vehicle | null;
  carrier?: TransportCompany | null;
  employment_type?: "autonomous" | "carrier" | string;
  is_online: boolean;
  latitude: number | null;
  longitude: number | null;
  last_seen: string | null;
  status: DriverStatus;
  notes: string | null;
  availability_city?: string | null;
  availability_at?: string | null;
  availability_since: string | null;
  rating: number;
  total_trips: number;
  created_at: string;
};

export type TransportCompany = {
  id: string;
  legal_name?: string;
  name?: string;
  cnpj: string;
  state_registration?: string | null;
  phone?: string;
  address?: string;
  email?: string;
  status: string;
};

export type Vehicle = {
  id: string;
  type: string;
  plate: string;
  capacity: string | null;
  compartments: string | null;
  product_type: string | null;
  homologation_status: string;
  company: TransportCompany | null;
  products: string[];
};
