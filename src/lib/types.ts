export type UserRole = "admin" | "operator" | "driver";

export type Profile = {
  id: string;
  user_id: string;
  role: UserRole;
  full_name: string | null;
  created_at: string;
};

export type DriverStatus =
  | "offline"
  | "available"
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
  plate: string | null;
  cnh: string | null;
  city: string | null;
  state: string | null;
  is_online: boolean;
  latitude: number | null;
  longitude: number | null;
  last_seen: string | null;
  status: DriverStatus;
  rating: number;
  total_trips: number;
  created_at: string;
};
