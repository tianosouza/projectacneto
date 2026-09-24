import type { LatLngTuple } from "leaflet";

export type AccessLevel = "cliente" | "operador" | "admin";

export type DemoContact = {
  id: string;
  kind?: "collection_point" | "final_customer";
  name: string;
  email: string;
  phone?: string | null;
  region: string;
  accessLevel: AccessLevel;
  status: "ativo" | "pendente";
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  financeEnabled?: boolean;
  negotiationsEnabled?: boolean;
};

export type PendingUser = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  requested_role: "driver" | "carrier" | "operator";
  registration_notes: string | null;
  approval_closed?: boolean;
  company_id?: string | null;
  company?: {
    legal_name: string;
    cnpj: string;
    state_registration: string | null;
    phone: string;
    address: string;
    email: string;
    status: string;
  } | null;
  driver?: ApprovalDriverFields | null;
  created_at: string;
};

export type ApprovalDriverFields = {
  full_name: string;
  phone: string;
  vehicle_model: string;
  vehicle_year: string;
  plate: string;
  city: string;
  state: string;
  capacity: string;
  compartments: string;
  cpf: string;
  cnh: string;
  cnh_category: string;
  cnh_expires_at: string;
  location_sharing_authorized: boolean;
  employment_type?: "autonomous" | "carrier" | string;
  carrier?: {
    id: string;
    name?: string;
    legal_name?: string;
    cnpj: string;
  } | null;
};

export type DemoDriver = {
  id: string;
  full_name: string;
  email: string | null;
  city: string;
  state: string;
  vehicle_model: string;
  plate: string;
  phone: string | null;
  capacity: string;
  compartments: string;
  notes: string;
  availability_since: string;
  is_online: boolean;
  rating: number;
  status:
    | "available"
    | "awaiting_loading"
    | "awaiting_documents"
    | "in_transit"
    | "awaiting_unloading"
    | "offline"
    | "in_negotiation";
  latitude: number | null;
  longitude: number | null;
  last_seen?: string;
  availability_city?: string | null;
  availability_at?: string | null;
  cpf?: string | null;
  cnh?: string | null;
  cnh_category?: string | null;
  cnh_expires_at?: string | null;
  homologation_status?: string;
  location_sharing_authorized?: boolean;
  current_vehicle?: {
    id: string;
    type: string;
    plate: string;
    capacity: string | null;
    compartments: string | null;
    products: string[];
    homologation_status: string;
    company: {
      id: string;
      name: string;
      cnpj: string | null;
      status: string;
    } | null;
  } | null;
  carrier?: {
    id: string;
    name: string;
    cnpj: string | null;
    status: string;
  } | null;
  employment_type?: "autonomous" | "carrier" | string;
  carrier_id?: string;
};

export type DirectoryOperator = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  finance_enabled?: boolean;
  negotiations_enabled?: boolean;
};

export type RouteSummary = {
  distance: number;
  duration: number;
};

export type RouteState = {
  path: LatLngTuple[];
  summary: RouteSummary | null;
  loading: boolean;
  error: string;
};
