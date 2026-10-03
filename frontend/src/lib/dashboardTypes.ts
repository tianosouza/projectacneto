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
  company_ids?: string[];
  financeEnabled?: boolean;
  negotiationsEnabled?: boolean;
};

export type OperationalLocation = {
  id: string;
  kind: "collection_point" | "final_customer";
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  company_ids?: string[];
};

export type PendingUser = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  requested_role: "driver" | "carrier" | "client" | "operator";
  registration_notes: string | null;
  attachments?: Array<{ id: string; name: string; mime_type: string }>;
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
  availability_city?: string | null;
  availability_at?: string | null;
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

export type FreightRouteStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";

export type FreightRouteAssignment = {
  id: string;
  driver_id: string;
  driver: DemoDriver | null;
  capacity: string | null;
  status: "active" | "completed" | "cancelled";
  progress_status:
    | "assigned"
    | "en_route_collection"
    | "awaiting_collection_confirmation"
    | "collection_confirmed"
    | "en_route_customer"
    | "awaiting_customer_confirmation"
    | "completed";
  accepted_at: string;
  ended_at: string | null;
  collection_arrived_at: string | null;
  collection_confirmed_at: string | null;
  customer_arrived_at: string | null;
  customer_confirmed_at: string | null;
  chat_offer: FreightChatOffer | null;
};

export type FreightChatOffer = {
  id: string;
  route_id: string;
  driver_id: string;
  driver: { id: string; full_name: string } | null;
  created_by: { id: string; full_name: string | null; email: string } | null;
  amount_cents: number;
  status: "offered" | "accepted" | "rejected" | "completed" | "superseded";
  created_at: string;
  responded_at: string | null;
  accepted_assignment_id: string | null;
  route?: {
    id: string;
    distance_km: number | null;
    collection_point: OperationalLocation | null;
    final_customer: OperationalLocation | null;
  } | null;
};

export type FreightRoute = {
  id: string;
  created_by_user_id: string;
  created_by: { id: string; full_name: string | null; email: string } | null;
  collection_point_id: string;
  collection_point: OperationalLocation | null;
  final_customer_id: string;
  final_customer: OperationalLocation | null;
  distance_km: number | null;
  status: FreightRouteStatus;
  assignments: FreightRouteAssignment[];
  chat_offers: FreightChatOffer[];
  active_driver_count: number;
  created_at: string;
  updated_at: string;
};

export type FreightRouteReportSummary = {
  total_routes: number;
  total_distance_km: number;
  status_breakdown: Record<string, number>;
  by_driver: Array<{ driver_id: string; name: string; route_count: number }>;
  by_client: Array<{ location_id: string; name: string; route_count: number }>;
};

export type FreightRouteDashboard = {
  total_routes: number;
  active_routes: number;
  completed_routes: number;
  cancelled_routes: number;
  total_distance_km: number;
  status_breakdown: Record<string, number>;
  top_drivers: Array<{ driver_id: string; name: string; route_count: number }>;
  top_clients: Array<{
    location_id: string;
    name: string;
    route_count: number;
  }>;
  daily_series: Array<{ date: string; count: number }>;
};

export type FreightSettlement = {
  id: string;
  assignment_id: string;
  driver_claimed_amount_cents: number | null;
  confirmed_amount_cents: number | null;
  driver_notes: string | null;
  operations_notes: string | null;
  payment_reference: string | null;
  payment_proof_file_name: string | null;
  payment_proof_mime_type: string | null;
  has_payment_proof: boolean;
  status: "pending" | "approved" | "paid";
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  assignment: {
    id: string;
    status: string;
    accepted_at: string;
    ended_at: string | null;
    driver: { id: string; full_name: string };
    route: {
      id: string;
      distance_km: number | null;
      collection_point: OperationalLocation;
      final_customer: OperationalLocation;
    };
  };
};
